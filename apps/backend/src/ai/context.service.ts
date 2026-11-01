import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelProvider } from '../model-provider/entities/model-provider.entity.js';
import { resolveOutputMaxTokens } from '../model-provider/model-client.factory.js';
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
    // 即 AI_OUTPUT_MAX_TOKENS），否则「输入 + 输出预留 > 窗口」会被供应商以超长拒绝。
    // 但输出预留**不超过窗口的一半**：否则 8k/16k/32k 这类常见小窗口会被默认预留占满，
    // 输入预算归零、静默丢弃全部历史（表现为「模型失忆」）；安全边际则防本地 tokenizer
    // （估算/模板/特殊 token 未计满）与真实分词偏差。
    const window = provider.contextLength;
    const outputReserve = Math.min(
      resolveOutputMaxTokens(this.config),
      Math.floor(window / 2),
    );
    const contextLimit = Math.min(
      this.config.get<number>('AI_CONTEXT_TOKEN_LIMIT', 131072),
      Math.max(0, window - outputReserve),
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

    // 历史行只做**内容可用性**过滤（AI 行内容非空即可用，不看 status）：
    // saveFailure 可能把「半截」回答以 failed 落库、用户停止是 aborted——它们用户都已在
    // 气泡里看到，下一轮按 status 剔除会让上下文整体丢失，模型只能重答；Anthropic 真正
    // 拒的是空 text block，所以判据收敛为「AI 行 content 非空」。null/无 status 的行也放行。
    const usable = history.filter(
      (m) =>
        m.role === MessageRole.User ||
        (m.role === MessageRole.Ai && m.content.trim().length > 0),
    );

    // 尾部「有问无答」的孤立 user 行先裁掉，再算预算：凭证/上游失败会在最新一轮留下
    // 未被回答的 user 行，过滤空 AI 行后相邻 Human 会破坏角色交替（Bedrock/兼容网关直接
    // 400），且下一轮会把同一问题重复送入。必须先裁后算——若留到选行之后再裁，它已经
    // 占掉 token 额度，而选行遇到放不下的行就停，本可保留的更早完整轮次会被一起挤掉。
    let tailEnd = usable.length;
    while (tailEnd > 0 && usable[tailEnd - 1].role === MessageRole.User) {
      tailEnd--;
    }
    const answered = usable.slice(0, tailEnd);

    // 从最近往前累计，超预算即停
    const selected: Message[] = [];
    let used = 0;
    for (const m of [...answered].reverse()) {
      const tokens = await this.tokenizer.countTokens(m.content, model);
      if (used + tokens > historyBudget) break;
      selected.push(m);
      used += tokens;
    }

    // 裁尾只处理「最新一轮缺回答」，空 AI 行落在**中间**时同样会留下孤立 user：
    // [u1, ai1(''), u2, ai2('ok')] 过滤后是 [u1, u2, ai2]，尾部不是 user 故不触发裁剪，
    // 畸形序列（Human、Human、AI）会被每一轮都带进去。这里补一次完整的不变式修复：
    // - 相邻 user 只保留更近的那条（旧问题已被后续提问取代，重复送还容易让模型串线）；
    // - 首条非 system 消息必须是 user（预算裁剪可能把某轮回答留下、却把它的提问裁掉）。
    const normalized: Message[] = [];
    for (const m of selected.toReversed()) {
      if (
        m.role === MessageRole.User &&
        normalized.at(-1)?.role === MessageRole.User
      ) {
        normalized.pop();
      }
      normalized.push(m);
    }
    while (normalized.length > 0 && normalized[0].role !== MessageRole.User) {
      normalized.shift();
    }

    for (const m of normalized) {
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
}
