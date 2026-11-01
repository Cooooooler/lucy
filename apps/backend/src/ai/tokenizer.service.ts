import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/app-logger.service.js';
import { OUTBOUND_FETCH } from '../common/guarded-fetch.service.js';
import { blockedErrorMessage } from '../common/provider-error.js';

@Injectable()
export class TokenizerService {
  // 缓存键：`${model}\u0000${text}`，避免嵌套 Map 增长失控
  private readonly cache = new Map<string, number>();
  // 缓存容量上限，超限淘汰最旧条目（Map 保持插入序）
  private readonly maxCacheEntries: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(OUTBOUND_FETCH) private readonly outboundFetch: typeof fetch,
    private readonly logger: AppLogger,
  ) {
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
      // tokenizer 在 prepareRun 请求路径上，不能复用聊天的空闲超时（默认 120s）；
      // 单独给一个短上界，Ollama 收下连接却不返回时不至于白等两分钟
      const configured = Number(
        this.config.get('AI_TOKENIZER_TIMEOUT_MS', 10_000),
      );
      const timeoutMs =
        Number.isInteger(configured) && configured > 0 ? configured : 10_000;
      const res = await this.outboundFetch(`${baseUrl}/api/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        // 与 SSE 长连共享 per-origin 配额：短请求必须有上界，Ollama 无响应时
        // 不能让新会话卡在 tokenizer 阶段等到 undici 默认的 5 分钟
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // 非成功响应也要释放 body，否则共享连接池的 socket 不会归还；
        // Ollama 持续 4xx/5xx 时会累积占满连接，拖慢对话/embedding
        await res.body?.cancel().catch(() => {});
        throw new Error(`tokenize failed: ${res.status}`);
      }
      const data = (await res.json()) as { count: number };
      this.cache.set(key, data.count);
      // 超限淘汰最旧条目（Map 保持插入序，刚插入后必然非空）
      if (this.cache.size > this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return data.count;
    } catch (error) {
      // 守卫拒绝不是「Ollama 暂不可用」，必须留痕，否则线上零线索
      const blocked = blockedErrorMessage(error);
      if (blocked) {
        this.logger.warn(
          `tokenizer 请求被出站守卫拒绝：${blocked}`,
          TokenizerService.name,
        );
      }
      // Ollama 不可用时按字符数估算（中文约 0.5 token/字）
      return Math.ceil(text.length / 2);
    }
  }
}
