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

// Ollama 流式 chunk：content 为回答片段；thinking 模型另带 reasoning_content；done_reason 标识结束原因（stop/length）
type AiChunk = {
  content: unknown;
  additional_kwargs?: { reasoning_content?: string };
  response_metadata?: { done_reason?: string };
};

// 流式订阅方：next 逐帧推送事件，complete 结束流
type Subscriber = {
  next: (e: AiStreamEvent) => void;
  complete: () => void;
};

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

  /** AI：创建会话。 */
  create(userId: string, dto: CreateConversationDto): Promise<Conversation> {
    return this.conversationRepo.save({ userId, model: dto.model ?? null });
  }

  /** AI：分页查询会话列表。 */
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

  /** AI：拉取单会话（带消息）。 */
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

  /** AI：重命名会话。 */
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

  /** AI：删除会话（含消息级联）。 */
  async remove(userId: string, id: string): Promise<null> {
    const result = await this.conversationRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('会话不存在');
    return null;
  }

  /** AI：发送消息并以 SSE 事件流返回模型输出。 */
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
    subscriber: Subscriber,
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    controller: AbortController,
    requestId: string,
  ): Promise<void> {
    const signal = controller.signal;
    const prepared = await this.prepareRun(
      subscriber,
      userId,
      conversationId,
      dto,
      requestId,
    );
    // 会话不存在时 prepareRun 已发 error 帧，直接结束
    if (!prepared) return;
    const { history, model } = prepared;

    // 推理模型默认开启深度思考：推理模型以 think=false 运行，易产出退化/半途截断的
    // 输出（如「先试着…」后即结束）。仅在调用方未显式指定时才按模型能力兜底，
    // 显式 reasoning:{true|false} 仍被尊重。
    const think = dto.reasoning ?? this.isReasoningModel(model);
    const client = this.ollamaFactory.getClient(model, think);
    const messages = await this.contextService.buildMessages(
      history,
      dto.content,
      model,
    );

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
    const abortPromise = this.createAbortPromise(signal);

    // 累积结果用可变 box：流中断（超时/中止/抛错）时也保留已产出内容，状态由 collectStream 原地更新
    const collected: {
      answer: string;
      thinkingAll: string;
      finishReason?: string;
    } = { answer: '', thinkingAll: '' };
    try {
      // 传入 signal：订阅取消（SSE 断线）时中止底层流，半截内容落 aborted
      const stream = (await client.stream(messages, { signal })) as
        AsyncIterable<AiChunk> | Iterable<AiChunk>;
      armIdle();
      await this.collectStream(
        subscriber,
        requestId,
        this.toAsyncIterator(stream),
        abortPromise,
        armIdle,
        collected,
      );
      await this.saveComplete(subscriber, requestId, {
        conversationId,
        answer: collected.answer,
        thinkingAll: collected.thinkingAll,
        finishReason: collected.finishReason,
      });
    } catch (error) {
      // 按失败类型区分错误码：客户端中止 / 模型超时 / 其他生成失败
      await this.saveFailure(subscriber, requestId, signal, error, {
        conversationId,
        answer: collected.answer,
        thinkingAll: collected.thinkingAll,
      });
    } finally {
      clearTimeout(idleTimer);
    }
  }

  // 流式前置准备：校验会话、读历史、落用户消息、刷新会话、必要时生成标题，并解析模型与上下文。
  // 会话不存在时向订阅方发 error 帧并返回 null，runSend 据此提前结束。
  private async prepareRun(
    subscriber: Subscriber,
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    requestId: string,
  ): Promise<{ history: Message[]; model: string } | null> {
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
      return null;
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
    return { history, model };
  }

  // 中止守卫：signal 中止时以 reason 拒绝，供流读取竞速；吞掉拒绝避免 unhandled rejection
  private createAbortPromise(signal: AbortSignal): Promise<never> {
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(signal.reason as Error);
      signal.addEventListener('abort', () => reject(signal.reason as Error), {
        once: true,
      });
    });
    abortPromise.catch(() => {});
    return abortPromise;
  }

  // 消费模型流：逐帧与中止竞速，把回答/思考累积进 collected（原地更新，中断时保留已产出内容）并透传 delta
  private async collectStream(
    subscriber: Subscriber,
    requestId: string,
    iterator: {
      next(): IteratorResult<AiChunk> | Promise<IteratorResult<AiChunk>>;
    },
    abortPromise: Promise<never>,
    armIdle: () => void,
    collected: {
      answer: string;
      thinkingAll: string;
      finishReason?: string;
    },
  ): Promise<void> {
    while (true) {
      const nextPromise = Promise.resolve(iterator.next());
      // 竞速失败（中止）后遗留的 next() 可能拒绝，吞掉避免 unhandled rejection
      nextPromise.catch(() => {});
      const { value: chunk, done } = (await Promise.race([
        nextPromise,
        abortPromise,
      ])) as { value: AiChunk; done: boolean };
      if (done) break;
      armIdle();
      // 末 chunk 的 response_metadata.done_reason 透传 Ollama 的结束原因（stop/length），
      // 用于识别「长度截断」生成，避免与正常结束混淆
      const dr = chunk.response_metadata?.done_reason;
      if (dr) collected.finishReason = dr;
      // 思考模型（think=true）把思考链放在 additional_kwargs.reasoning_content，
      // 实际回答在 content：拆成 thinking/content 两路帧，前端可区分展示
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      const reasoning = chunk.additional_kwargs?.reasoning_content ?? '';
      if (reasoning) {
        collected.thinkingAll += reasoning;
        subscriber.next({
          type: 'delta',
          requestId,
          role: 'ai',
          data: { thinking: reasoning },
        });
      }
      if (text) {
        collected.answer += text;
        subscriber.next({
          type: 'delta',
          requestId,
          role: 'ai',
          data: { content: text },
        });
      }
    }
  }

  // 正常完成：落库 complete（含截断标记）并发送 done 帧
  private async saveComplete(
    subscriber: Subscriber,
    requestId: string,
    context: {
      conversationId: string;
      answer: string;
      thinkingAll: string;
      finishReason?: string;
    },
  ): Promise<void> {
    const truncated = context.finishReason === 'length';
    await this.messageRepo.save({
      conversationId: context.conversationId,
      role: MessageRole.Ai,
      content: context.answer,
      thinking: context.thinkingAll || null,
      status: MessageStatus.Complete,
      // 持久化截断标记：刷新/重开会话后仍能识别「长度截断」的半截回答
      truncated,
    });
    subscriber.next({
      type: 'done',
      requestId,
      role: 'ai',
      data: {
        finish_reason: truncated ? 'length' : 'stop',
        ...(truncated ? { truncated: true } : {}),
      },
    });
    subscriber.complete();
  }

  // 生成失败/中断：按失败类型落库并发送 error 帧
  private async saveFailure(
    subscriber: Subscriber,
    requestId: string,
    signal: AbortSignal,
    error: unknown,
    context: { conversationId: string; answer: string; thinkingAll: string },
  ): Promise<void> {
    const kind = this.classifyError(error, signal);
    const status =
      kind.code === ErrorCode.AI_GENERATE_ABORTED
        ? MessageStatus.Aborted
        : MessageStatus.Failed;
    await this.messageRepo.save({
      conversationId: context.conversationId,
      role: MessageRole.Ai,
      content: context.answer,
      thinking: context.thinkingAll || null,
      status,
    });
    subscriber.next({
      type: 'error',
      requestId,
      data: { code: kind.code, message: kind.message },
    });
    subscriber.complete();
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

  // 是否推理（深度思考）模型：按模型名家族粗判。真实能力以 Ollama capabilities 为准，
  // 这里用名称启发式，避免每次请求都打 Ollama /api/show 探测。命中即默认开启 think，
  // 因推理模型以 think=false 运行易产出退化/半途截断输出。
  private isReasoningModel(model: string): boolean {
    return /qwen3(?:\.\d+)?|deepseek-r1|(?:^|[-:])r1(?:[-:.]|$)/i.test(model);
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
