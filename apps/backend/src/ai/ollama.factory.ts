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
    });
    this.cache.set(key, client);
    // 超限淘汰最旧条目（刚插入后必然非空）
    if (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return client;
  }
}
