import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    model: string,
  ): Promise<(SystemMessage | HumanMessage | AIMessage)[]> {
    const limit = this.config.get<number>('AI_CONTEXT_TOKEN_LIMIT', 4096);
    const reserveRatio = this.config.get<number>(
      'AI_CONTEXT_RESERVE_RATIO',
      0.7,
    );
    const budget = Math.floor(limit * reserveRatio);

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [];
    const systemPrompt = this.config.get<string>('AI_SYSTEM_PROMPT', '');
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));

    // 从最近往前累计，超预算即停
    const selected: Message[] = [];
    let used = 0;
    for (const m of [...history].reverse()) {
      const tokens = await this.tokenizer.countTokens(m.content, model);
      if (used + tokens > budget) break;
      selected.push(m);
      used += tokens;
    }

    for (const m of selected.reverse()) {
      if (m.role === MessageRole.User) {
        messages.push(new HumanMessage(m.content));
      } else if (m.role === MessageRole.Assistant) {
        messages.push(new AIMessage(m.content));
      }
      // system 角色仅来自配置注入，历史中的 system 行忽略
    }
    messages.push(new HumanMessage(newContent));
    return messages;
  }
}
