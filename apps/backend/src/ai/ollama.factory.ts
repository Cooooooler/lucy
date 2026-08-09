import { ChatOllama } from '@langchain/ollama';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OllamaFactory {
  private readonly cache = new Map<string, ChatOllama>();

  constructor(private readonly config: ConfigService) {}

  getClient(model?: string): ChatOllama {
    const resolved =
      model ?? this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    const cached = this.cache.get(resolved);
    if (cached) return cached;
    const client = new ChatOllama({
      baseUrl: this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
      model: resolved,
    });
    this.cache.set(resolved, client);
    return client;
  }
}
