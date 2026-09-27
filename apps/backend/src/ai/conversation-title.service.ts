import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity.js';
import { Message, MessageRole } from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';

/**
 * 会话标题生成：按首条用户消息生成简短标题并写回 `conversation.title`。
 *
 * 单独成服务（`arch-single-responsibility`）：它是对**会话元信息**的写入，与流式管线的
 * 「模型流 / 空闲超时 / 落库状态机」不是同一件事。`ChatStreamService` 在首条消息路径上
 * 携带本次 `signal` 调用它；失败由调用方决定是否忽略（标题缺失不影响正文问答）。
 */
@Injectable()
export class ConversationTitleService {
  constructor(
    private readonly config: ConfigService,
    private readonly ollamaFactory: OllamaFactory,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  /**
   * 生成并写回标题（仅在会话尚无标题时写）。失败上抛，由调用方记录日志并继续。
   *
   * @param conversation 目标会话（读取其首条用户消息与模型）
   * @param signal 本次请求的中止信号：标题生成在首条消息路径上被 await，挂起会拖住正文流，
   *   故必须可被客户端断线中止，并有独立超时兜底（见 {@link invokeTitle}）
   */
  async generate(
    conversation: Conversation,
    signal: AbortSignal,
  ): Promise<void> {
    const first = await this.messageRepo.findOne({
      where: { conversationId: conversation.id, role: MessageRole.User },
      order: { createdAt: 'ASC' },
    });
    if (!first) return;
    const prompt = this.config.get<string>(
      'AI_TITLE_PROMPT',
      '为这段对话生成一个不超过20字的简短标题，只输出标题本身：',
    );
    const title = await this.invokeTitle(
      `${prompt}${first.content}`,
      conversation.model,
      signal,
    );
    if (title) {
      await this.conversationRepo.update(
        { id: conversation.id, title: IsNull() },
        { title },
      );
    }
  }

  /**
   * 标题生成调用：既有独立超时兜底，又受调用方 `signal` 约束（SSE 断线可中止）。
   * 竞速的败者（超时/中止胜出后仍在途的 invoke）若稍后 reject 需自行吞掉，避免
   * 未处理的 rejection 冒到进程级（与 `ChatStreamService.collectStream` 同法）。
   */
  private async invokeTitle(
    prompt: string,
    model: string | null,
    signal: AbortSignal,
  ): Promise<string> {
    const client = this.ollamaFactory.getClient(model ?? undefined);
    const timeoutMs = Number(this.config.get('OLLAMA_TIMEOUT_MS', 120000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('标题生成超时')), timeoutMs);
      // 超时定时器不阻止进程退出
      timer.unref?.();
    });
    const invoking = client.invoke([new HumanMessage(prompt)], { signal });
    invoking.catch(() => {});
    try {
      const res = (await Promise.race([
        invoking,
        this.abortGuard(signal),
        timeout,
      ])) as { content: unknown };
      const raw = res.content;
      return typeof raw === 'string' ? raw.trim().slice(0, 50) : '';
    } finally {
      clearTimeout(timer);
    }
  }

  // 中止守卫：signal 中止时以 reason 拒绝，供竞速；吞掉拒绝避免 unhandled rejection
  private abortGuard(signal: AbortSignal): Promise<never> {
    const guard = new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(signal.reason as Error);
      signal.addEventListener('abort', () => reject(signal.reason as Error), {
        once: true,
      });
    });
    guard.catch(() => {});
    return guard;
  }
}
