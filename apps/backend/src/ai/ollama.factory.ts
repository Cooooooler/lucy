import { ChatOllama } from '@langchain/ollama';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OllamaFactory {
  private readonly cache = new Map<string, ChatOllama>();
  // 缓存容量上限，超限淘汰最旧条目（Map 保持插入序），与 tokenizer 一致
  private readonly maxCacheEntries = 50;

  constructor(private readonly config: ConfigService) {}

  getClient(model?: string, think = false): ChatOllama {
    const resolved =
      model ?? this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    // think 是 ChatOllama 实例级参数（invocationParams 透传顶层 think），须纳入缓存 key
    const key = `${resolved}:${think}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const client = new ChatOllama({
      baseUrl: this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
      model: resolved,
      think,
      // 把「给生成内容预留的空间」落到模型参数：numPredict 即 Ollama 的 num_predict，
      // 明确限制本次生成的最大输出 token，让预留真正生效而非仅做算账。
      numPredict: this.resolveMaxTokens(),
    });
    this.cache.set(key, client);
    // 超限淘汰最旧条目（刚插入后必然非空）
    if (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return client;
  }

  /**
   * 解析并把有限正整数落到 numPredict：ConfigService 不强制类型，env 值实际是 string，
   * 需 Number coerce（如 "32768" → 32768）。仅接受有限正整数，否则（缺失/0/负数/小数/NaN/Infinity）
   * 回退默认 32768（与 .env.example 的 AI_OUTPUT_MAX_TOKENS 一致），避免把畸形值传给 ChatOllama。
   */
  private resolveMaxTokens(): number {
    const parsed = Number(this.config.get('AI_OUTPUT_MAX_TOKENS', 32768));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 32768;
  }
}
