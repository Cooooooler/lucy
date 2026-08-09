import { HumanMessage } from '@langchain/core/messages';
import {
  Injectable,
  NotFoundException,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
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
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      if (this.inFlight.has(conversationId)) {
        subscriber.next({ type: 'error', data: '该会话正在生成中，请稍候' });
        subscriber.complete();
        return;
      }

      const controller = new AbortController();
      const promise = this.runSend(
        subscriber,
        userId,
        conversationId,
        dto,
        controller.signal,
      )
        .catch((err) => {
          subscriber.next({
            type: 'error',
            data: err instanceof Error ? err.message : '生成失败',
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
    subscriber: { next: (e: MessageEvent) => void; complete: () => void },
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    signal: AbortSignal,
  ): Promise<void> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      subscriber.next({ type: 'error', data: '会话不存在' });
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

    const count = await this.messageRepo.count({ where: { conversationId } });
    if (count === 1) {
      void this.generateTitle(conversation).catch(() => {});
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
    try {
      // 传入 signal：订阅取消（SSE 断线）时中止底层流，半截内容落 aborted
      const stream = await client.stream(messages, { signal });
      for await (const chunk of stream) {
        const text = chunk.content;
        if (typeof text === 'string' && text.length > 0) {
          full += text;
          subscriber.next({ type: 'delta', data: text });
        }
      }
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Assistant,
        content: full,
        status: MessageStatus.Complete,
      });
      subscriber.next({ type: 'done', data: '' });
      subscriber.complete();
    } catch {
      const status = full ? MessageStatus.Aborted : MessageStatus.Failed;
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Assistant,
        content: full,
        status,
      });
      subscriber.next({
        type: 'error',
        data: status === MessageStatus.Aborted ? '生成中断' : '生成失败',
      });
      subscriber.complete();
    }
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
