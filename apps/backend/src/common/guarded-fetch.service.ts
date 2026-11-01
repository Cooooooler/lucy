import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch.js';

/** 正整数配置读取：非法/缺失返回 undefined，交回 undici 默认值 */
function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** 优雅关闭的等待上限：超过则强制 destroy（避免卡住的在途请求拖住 app.close） */
const CLOSE_TIMEOUT_MS = 3000;

/**
 * 出站 fetch 守卫（SSRF 校验 + 不跟随重定向 + 连接池生命周期）。
 *
 * 进程级共享基础设施，放在 CommonModule：对话、embedding、Ollama tokenizer
 * 等所有出站路径复用同一套校验与连接池，停机时由 Nest 统一关闭。
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

  /**
   * 先优雅关闭，但有硬上限：undici 的 `Agent.close()` 会一直等所有在途请求结束，
   * 而 embedding 探针不支持取消；停机时卡住的请求不能让 `app.close()` 永久挂住，
   * 超时后强制 destroy（中止在途连接）。
   */
  async onApplicationShutdown(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.guard.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    await this.guard.destroy();
  }
}
