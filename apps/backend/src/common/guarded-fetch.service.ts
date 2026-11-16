import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './app-logger.service.js';
import { parsePrivateHostAllowlist } from './base-url-guard.js';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch.js';
import { ShutdownService } from './shutdown.service.js';

/** 正整数配置读取：非法/缺失返回 undefined，交回 undici 默认值 */
function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** 优雅关闭上限：不超过 3s，且必须给 ShutdownService 的兜底强退留出余量 */
const MAX_CLOSE_TIMEOUT_MS = 3000;
const FORCE_EXIT_RESERVE_MS = 1000;

/** 允许私网/回环的出站 fetch：Ollama（本地/LAN）与 tokenizer 使用 */
export const OUTBOUND_FETCH = Symbol('OUTBOUND_FETCH');
/**
 * 只允许公网的出站 fetch：云端 vendor（OpenAI/Anthropic）使用，
 * `OUTBOUND_ALLOW_PRIVATE_HOSTS` 可显式放行内网自建网关。
 */
export const OUTBOUND_FETCH_PUBLIC_ONLY = Symbol('OUTBOUND_FETCH_PUBLIC_ONLY');

/** 单个出站连接池 + 归因用的名字（停机日志要区分是哪个池卡住） */
interface GuardedPool {
  label: string;
  guard: GuardedFetch;
}

/**
 * 出站 fetch 守卫（SSRF 校验 + 不跟随重定向 + 连接池生命周期）。
 *
 * 进程级共享基础设施，放在 CommonModule：对话、embedding、Ollama tokenizer
 * 等所有出站路径复用同一套校验与连接池，停机时由 Nest 统一关闭。
 *
 * 地址策略按**用途**分成两个池（策略在 undici lookup 里固化，无法按请求切换）：
 * - `fetch`：私网/回环放行，本地 Ollama 与 tokenizer 用；
 * - `publicOnlyFetch`：只许公网，云端 vendor 用；`OUTBOUND_ALLOW_PRIVATE_HOSTS`
 *   是显式白名单（见 `BaseUrlPolicy`）。
 * 两个池共用 `OUTBOUND_*` 连接池参数，各自持有一份 undici Agent。
 */
@Injectable()
export class GuardedFetchService implements OnApplicationShutdown {
  private readonly pools: GuardedPool[];
  private readonly privateAllowed: GuardedFetch;
  private readonly publicOnly: GuardedFetch;

  constructor(
    config: ConfigService,
    private readonly logger: AppLogger,
    private readonly shutdown: ShutdownService,
  ) {
    const poolOptions = {
      maxConnections: positiveInt(config.get('OUTBOUND_MAX_CONNECTIONS')),
      connectTimeoutMs: positiveInt(config.get('OUTBOUND_CONNECT_TIMEOUT_MS')),
    };
    this.privateAllowed = createGuardedFetch({
      ...poolOptions,
      policy: { allowPrivateHosts: true },
    });
    this.publicOnly = createGuardedFetch({
      ...poolOptions,
      policy: {
        allowPrivateHosts: false,
        allowedPrivateHosts: parsePrivateHostAllowlist(
          config.get('OUTBOUND_ALLOW_PRIVATE_HOSTS'),
        ),
      },
    });
    this.pools = [
      { label: '私网放行', guard: this.privateAllowed },
      { label: '仅公网', guard: this.publicOnly },
    ];
  }

  /** 注入给 Ollama / tokenizer 的 `fetch`（允许私网/回环） */
  get fetch(): typeof fetch {
    return this.privateAllowed.fetch;
  }

  /** 注入给云端供应商 SDK 的 `fetch`（默认只许公网） */
  get publicOnlyFetch(): typeof fetch {
    return this.publicOnly.fetch;
  }

  /**
   * 先优雅关闭，但有硬上限：undici 的 `Agent.close()` 会一直等所有在途请求结束，
   * 而 embedding 探针不支持取消；停机时卡住的请求不能让 `app.close()` 永久挂住，
   * 超时后强制 destroy（中止在途连接）。失败/强杀都留日志，便于停机后归因。
   *
   * 预算按 ShutdownService 的**剩余**宽限期计算：本钩子执行前可能已经用掉
   * HTTP server dispose / onModuleDestroy 的时间，不能再用固定 3s。
   */
  async onApplicationShutdown(): Promise<void> {
    const budget = Math.max(
      0,
      Math.min(
        MAX_CLOSE_TIMEOUT_MS,
        this.shutdown.remainingGraceMs() - FORCE_EXIT_RESERVE_MS,
      ),
    );
    if (budget === 0) {
      await this.destroy();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const closes = this.pools.map(({ label, guard }) =>
      guard.close().catch((error: unknown) => {
        this.logger.warn(
          `出站连接池（${label}）优雅关闭失败：${errorText(error)}`,
          GuardedFetchService.name,
        );
      }),
    );
    try {
      await Promise.race([
        Promise.all(closes),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, budget);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        this.logger.warn(
          `出站连接池 ${budget}ms 内未关闭，强制销毁`,
          GuardedFetchService.name,
        );
      }
      await this.destroy();
    }
  }

  private async destroy(): Promise<void> {
    await Promise.all(
      this.pools.map(({ label, guard }) =>
        guard.destroy().catch((error: unknown) => {
          this.logger.warn(
            `出站连接池（${label}）强制销毁失败：${errorText(error)}`,
            GuardedFetchService.name,
          );
        }),
      ),
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
