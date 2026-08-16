import { HumanMessage } from '@langchain/core/messages';
import { AiStreamEvent, ErrorCode, type ErrorCodeValue } from '@lucy/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { IsNull, Repository } from 'typeorm';
import { ContextService } from './context.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { Conversation } from './entities/conversation.entity.js';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly ollamaFactory: OllamaFactory,
    private readonly contextService: ContextService,
    private readonly config: ConfigService,
  ) {}

  // 同会话并发锁：key=conversationId，防止同会话并发生成（同时消除首条消息重复触发标题生成）
  private readonly inFlight = new Map<string, Promise<unknown>>();

  create(userId: string, dto: CreateConversationDto): Promise<Conversation> {
    return this.conversationRepo.save({ userId, model: dto.model ?? null });
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    list: Conversation[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [list, total] = await this.conversationRepo.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async get(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    conversation.messages = await this.messageRepo.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
    return conversation;
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    conversation.title = title;
    return this.conversationRepo.save(conversation);
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    const result = await this.conversationRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('会话不存在');
    return { success: true };
  }

  sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Observable<AiStreamEvent> {
    return new Observable<AiStreamEvent>((subscriber) => {
      const requestId = randomUUID();
      if (this.inFlight.has(conversationId)) {
        subscriber.next({
          type: 'error',
          requestId,
          data: {
            code: ErrorCode.AI_CONVERSATION_BUSY,
            message: '该会话正在生成中，请稍候',
          },
        });
        subscriber.complete();
        return;
      }

      const controller = new AbortController();
      const promise = this.runSend(
        subscriber,
        userId,
        conversationId,
        dto,
        controller,
        requestId,
      )
        .catch((err) => {
          subscriber.next({
            type: 'error',
            requestId,
            data: {
              code: ErrorCode.AI_GENERATE_FAILED,
              message: err instanceof Error ? err.message : '生成失败',
            },
          });
          subscriber.complete();
        })
        .finally(() => {
          this.inFlight.delete(conversationId);
        });
      this.inFlight.set(conversationId, promise);
      return () => controller.abort();
    });
  }

  private async runSend(
    subscriber: { next: (e: AiStreamEvent) => void; complete: () => void },
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    controller: AbortController,
    requestId: string,
  ): Promise<void> {
    const signal = controller.signal;
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      subscriber.next({
        type: 'error',
        requestId,
        data: {
          code: ErrorCode.AI_CONVERSATION_NOT_FOUND,
          message: '会话不存在',
        },
      });
      subscriber.complete();
      return;
    }

    // 先读前序历史（不含本次用户消息），新消息作为参数单独追加进上下文，避免重复
    const history = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    await this.messageRepo.save({
      conversationId,
      role: MessageRole.User,
      content: dto.content,
    });
    // 刷新会话 updatedAt，保证会话列表按最近活跃排序；
    // 显式设值确保脏检查必触发 UPDATE，不依赖 UpdateDateColumn 的自动刷新
    conversation.updatedAt = new Date();
    await this.conversationRepo.save(conversation);

    // 首条消息：先同步生成标题再开始回答，保证回答流结束时标题已就绪（前端拉列表时不再缺失）
    const count = await this.messageRepo.count({ where: { conversationId } });
    if (count === 1) {
      await this.generateTitle(conversation).catch(() => {});
    }

    const model =
      dto.model ??
      conversation.model ??
      this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    const client = this.ollamaFactory.getClient(model);

    const messages = await this.contextService.buildMessages(
      history,
      dto.content,
      model,
    );

    let full = '';
    // 空闲超时：模型持续无输出（含首 token 等待）超过阈值判为超时
    const timeoutMs = Number(this.config.get('OLLAMA_TIMEOUT_MS', 120000));
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort(new Error('Model request timed out'));
      }, timeoutMs);
      // 超时定时器不阻止进程退出，避免测试/短生命周期场景被挂起定时器阻塞
      idleTimer.unref?.();
    };
    // LangChain Ollama 未把 signal 接入底层 fetch，流挂起时 abort 不会自动冒出；
    // 故每次读取与 signal 竞速，保证超时/断线能立即中断阻塞的读取
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(signal.reason as Error);
      signal.addEventListener('abort', () => reject(signal.reason as Error), {
        once: true,
      });
    });
    // 中止可能发生在竞速结束后，吞掉拒绝避免 unhandled rejection
    abortPromise.catch(() => {});
    try {
      // 传入 signal：订阅取消（SSE 断线）时中止底层流，半截内容落 aborted
      const stream = (await client.stream(messages, { signal })) as
        AsyncIterable<{ content: unknown }> | Iterable<{ content: unknown }>;
      armIdle();
      const iterator = this.toAsyncIterator(stream);
      while (true) {
        const nextPromise = Promise.resolve(iterator.next());
        // 竞速失败（中止）后遗留的 next() 可能拒绝，吞掉避免 unhandled rejection
        nextPromise.catch(() => {});
        const { value: chunk, done } = (await Promise.race([
          nextPromise,
          abortPromise,
        ])) as { value: { content: unknown }; done: boolean };
        if (done) break;
        armIdle();
        const text = chunk.content;
        if (typeof text === 'string' && text.length > 0) {
          full += text;
          subscriber.next({
            type: 'delta',
            requestId,
            role: 'ai',
            data: { content: text },
          });
        }
      }
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Ai,
        content: full,
        status: MessageStatus.Complete,
      });
      subscriber.next({
        type: 'done',
        requestId,
        role: 'ai',
        data: { finish_reason: 'stop' },
      });
      subscriber.complete();
    } catch (error) {
      // 按失败类型区分错误码：客户端中止 / 模型超时 / 其他生成失败
      const kind = this.classifyError(error, signal);
      const status =
        kind.code === ErrorCode.AI_GENERATE_ABORTED
          ? MessageStatus.Aborted
          : MessageStatus.Failed;
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Ai,
        content: full,
        status,
      });
      subscriber.next({
        type: 'error',
        requestId,
        data: { code: kind.code, message: kind.message },
      });
      subscriber.complete();
    } finally {
      clearTimeout(idleTimer);
    }
  }

  // 归一为统一的 next 接口：异步迭代器与同步迭代器（测试 mock 常用）都适配
  private toAsyncIterator<T>(stream: AsyncIterable<T> | Iterable<T>): {
    next(): IteratorResult<T> | Promise<IteratorResult<T>>;
  } {
    if (Symbol.asyncIterator in stream) {
      const iter = stream[Symbol.asyncIterator]();
      return { next: () => iter.next() };
    }
    const iter = stream[Symbol.iterator]();
    return { next: () => iter.next() };
  }

  // 区分流式失败类型：客户端中止（signal.reason）> 模型超时 > 其他生成失败
  private classifyError(
    error: unknown,
    signal: AbortSignal,
  ): { code: ErrorCodeValue; message: string } {
    if (signal.aborted) {
      const reason = signal.reason as Error;
      if (
        reason instanceof Error &&
        /timeout|timed out|ETIMEDOUT/i.test(reason.message)
      ) {
        return { code: ErrorCode.AI_GENERATE_TIMEOUT, message: '模型调用超时' };
      }
      return { code: ErrorCode.AI_GENERATE_ABORTED, message: '生成中断' };
    }
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : '';
    if (/timeout|timed out|ETIMEDOUT/i.test(`${name} ${message}`)) {
      return { code: ErrorCode.AI_GENERATE_TIMEOUT, message: '模型调用超时' };
    }
    return { code: ErrorCode.AI_GENERATE_FAILED, message: '生成失败' };
  }

  private async generateTitle(conversation: Conversation): Promise<void> {
    const first = await this.messageRepo.findOne({
      where: { conversationId: conversation.id, role: MessageRole.User },
      order: { createdAt: 'ASC' },
    });
    if (!first) return;
    const client = this.ollamaFactory.getClient(
      conversation.model ?? undefined,
    );
    const prompt = this.config.get<string>(
      'AI_TITLE_PROMPT',
      '为这段对话生成一个不超过20字的简短标题，只输出标题本身：',
    );
    const res = await client.invoke([
      new HumanMessage(`${prompt}${first.content}`),
    ]);
    const raw = res.content;
    const text = typeof raw === 'string' ? raw : '';
    const title = text.trim().slice(0, 50);
    if (title) {
      await this.conversationRepo.update(
        { id: conversation.id, title: IsNull() },
        { title },
      );
    }
  }
}
