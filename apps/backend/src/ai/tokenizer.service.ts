import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TokenizerService {
  // 缓存键：`${model}\u0000${text}`，避免嵌套 Map 增长失控
  private readonly cache = new Map<string, number>();
  // 缓存容量上限，超限淘汰最旧条目（Map 保持插入序）
  private readonly maxCacheEntries: number;

  constructor(private readonly config: ConfigService) {
    this.maxCacheEntries = this.config.get<number>(
      'AI_TOKENIZER_CACHE_SIZE',
      1000,
    );
  }

  async countTokens(text: string, model: string): Promise<number> {
    const key = `${model}\u0000${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const baseUrl = this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      );
      const res = await fetch(`${baseUrl}/api/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res.ok) throw new Error(`tokenize failed: ${res.status}`);
      const data = (await res.json()) as { count: number };
      this.cache.set(key, data.count);
      // 超限淘汰最旧条目（Map 保持插入序，刚插入后必然非空）
      if (this.cache.size > this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return data.count;
    } catch {
      // Ollama 不可用时按字符数估算（中文约 0.5 token/字）
      return Math.ceil(text.length / 2);
    }
  }
}
