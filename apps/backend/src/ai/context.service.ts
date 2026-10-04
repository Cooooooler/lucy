import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelProvider } from '../model-provider/entities/model-provider.entity.js';
import { Message, MessageRole } from './entities/message.entity.js';
import { TokenizerService } from './tokenizer.service.js';

@Injectable()
export class ContextService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenizer: TokenizerService,
  ) {}

  async buildMessages(
    history: Message[],
    newContent: string,
    provider: ModelProvider,
  ): Promise<(SystemMessage | HumanMessage | AIMessage)[]> {
    // 输入预算 = min(全局输入上限, 模型总窗口 − 输出预留) − 安全边际。
    // provider.contextLength 是模型**总窗口**，须先为生成输出留出空间（numPredict 默认
    // 即 AI_OUTPUT_MAX_TOKENS），否则小窗口模型会出现「输入 + 输出预留 > 窗口」被供应商以
    // 超长拒绝；安全边际则防本地 tokenizer（估算/模板/特殊 token 未计满）与真实分词偏差。
    const contextLimit = Math.min(
      this.config.get<number>('AI_CONTEXT_TOKEN_LIMIT', 131072),
      Math.max(0, provider.contextLength - this.resolveOutputReserve()),
    );
    const safetyMargin = this.config.get<number>(
      'AI_CONTEXT_SAFETY_MARGIN',
      2048,
    );
    const budget = Math.max(0, contextLimit - safetyMargin);
    const model = provider.name;

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [];
    const systemPrompt = this.config.get<string>('AI_SYSTEM_PROMPT', '');
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));

    // 预算须同时覆盖系统提示与新消息：扣除后剩余的才是历史可用额度
    const systemTokens = systemPrompt
      ? await this.tokenizer.countTokens(systemPrompt, model)
      : 0;
    const newTokens = await this.tokenizer.countTokens(newContent, model);
    const historyBudget = Math.max(0, budget - systemTokens - newTokens);

    // 从最近往前累计，超预算即停
    const selected: Message[] = [];
    let used = 0;
    for (const m of [...history].reverse()) {
      const tokens = await this.tokenizer.countTokens(m.content, model);
      if (used + tokens > historyBudget) break;
      selected.push(m);
      used += tokens;
    }

    for (const m of selected.toReversed()) {
      if (m.role === MessageRole.User) {
        messages.push(new HumanMessage(m.content));
      } else if (m.role === MessageRole.Ai) {
        messages.push(new AIMessage(m.content));
      }
      // system 角色仅来自配置注入，历史中的 system 行忽略
    }
    messages.push(new HumanMessage(newContent));
    return messages;
  }

  /**
   * 生成输出的预留 token：与 ModelClientFactory 的 numPredict 默认同源（AI_OUTPUT_MAX_TOKENS，
   * 非法/缺失回退 32768），用于在输入预算里为输出让出空间。
   */
  private resolveOutputReserve(): number {
    const parsed = Number(this.config.get('AI_OUTPUT_MAX_TOKENS', 32768));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 32768;
  }
}
