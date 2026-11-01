import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './app-logger.service.js';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch.js';

/** 正整数配置读取：非法/缺失返回 undefined，交回 undici 默认值 */
function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** 优雅关闭上限：不超过 3s，且必须给 ShutdownService 的兜底强退留出余量 */
const MAX_CLOSE_TIMEOUT_MS = 3000;
const FORCE_EXIT_RESERVE_MS = 1000;

/** 只暴露 fetch 函数的 DI token：消费方不必依赖连接池生命周期实现 */
export const OUTBOUND_FETCH = Symbol('OUTBOUND_FETCH');

/**
 * 出站 fetch 守卫（SSRF 校验 + 不跟随重定向 + 连接池生命周期）。
 *
 * 进程级共享基础设施，放在 CommonModule：对话、embedding、Ollama tokenizer
 * 等所有出站路径复用同一套校验与连接池，停机时由 Nest 统一关闭。
 */
@Injectable()
export class GuardedFetchService implements OnApplicationShutdown {
  private readonly guard: GuardedFetch;
  private readonly closeTimeoutMs: number;

  constructor(
    config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.guard = createGuardedFetch({
      maxConnections: positiveInt(config.get('OUTBOUND_MAX_CONNECTIONS')),
      connectTimeoutMs: positiveInt(config.get('OUTBOUND_CONNECT_TIMEOUT_MS')),
    });
    const grace = Number(config.get('SHUTDOWN_GRACE_MS', 15000));
    // 与 ShutdownService 的兜底窗口联动：宽限期很小时不能用 3s 固定预算，
    // 否则强退会先于连接池关闭触发（留 1s 给后续 dispose）
    this.closeTimeoutMs = Math.max(
      250,
      Math.min(MAX_CLOSE_TIMEOUT_MS, grace - FORCE_EXIT_RESERVE_MS),
    );
  }

  /** 注入给各 SDK 的 `fetch` 选项 / 直接调用 */
  get fetch(): typeof fetch {
    return this.guard.fetch;
  }

  /**
   * 先优雅关闭，但有硬上限：undici 的 `Agent.close()` 会一直等所有在途请求结束，
   * 而 embedding 探针不支持取消；停机时卡住的请求不能让 `app.close()` 永久挂住，
   * 超时后强制 destroy（中止在途连接）。失败/强杀都留日志，便于停机后归因。
   */
  async onApplicationShutdown(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        this.guard.close().catch((error: unknown) => {
          this.logger.warn(
            `出站连接池优雅关闭失败：${errorText(error)}`,
            GuardedFetchService.name,
          );
        }),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, this.closeTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        this.logger.warn(
          `出站连接池 ${this.closeTimeoutMs}ms 内未关闭，强制销毁`,
          GuardedFetchService.name,
        );
      }
      await this.guard.destroy().catch((error: unknown) => {
        this.logger.warn(
          `出站连接池强制销毁失败：${errorText(error)}`,
          GuardedFetchService.name,
        );
      });
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
