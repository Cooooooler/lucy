import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch.js';

/** 正整数配置读取：非法/缺失返回 undefined，交回 undici 默认值 */
function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 出站 fetch 守卫（SSRF 校验 + 不跟随重定向 + 连接池生命周期）。
 *
 * 抽成 provider 而不是工厂内部的私有字段：连接池是进程级共享资源，
 * 停机时由 Nest 统一调用 `onApplicationShutdown` 关闭；对话、embedding、
 * Ollama tokenizer 等所有出站路径复用同一套校验与连接池。
 */
@Injectable()
export class GuardedFetchService implements OnApplicationShutdown {
  private readonly guard: GuardedFetch;

  constructor(config: ConfigService) {
    this.guard = createGuardedFetch({
      maxConnections: positiveInt(config.get('OUTBOUND_MAX_CONNECTIONS')),
      connectTimeoutMs: positiveInt(config.get('OUTBOUND_CONNECT_TIMEOUT_MS')),
    });
  }

  /** 注入给各 SDK 的 `fetch` 选项 / 直接调用 */
  get fetch(): typeof fetch {
    return this.guard.fetch;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.guard.close();
  }
}
