import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createGuardedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./guarded-fetch.js', () => ({
  createGuardedFetch: createGuardedFetchMock,
}));

import type { AppLogger } from './app-logger.service.js';
import { GuardedFetchService } from './guarded-fetch.service.js';
import type { ShutdownService } from './shutdown.service.js';

describe('GuardedFetchService', () => {
  const close = vi.fn();
  const destroy = vi.fn();
  const privateFetch = vi.fn();
  const publicFetch = vi.fn();
  const loggerWarn = vi.fn();
  const loggerWarnWith = vi.fn();
  const remainingGraceMs = vi.fn(() => 15000);
  const logger = {
    warn: loggerWarn,
    warnWith: loggerWarnWith,
  } as unknown as AppLogger;
  const shutdown = { remainingGraceMs } as unknown as ShutdownService;

  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    destroy.mockResolvedValue(undefined);
    remainingGraceMs.mockReturnValue(15000);
    // 两个池各返回一份 fetch，便于断言注入的是「哪个策略」的池
    createGuardedFetchMock
      .mockReturnValueOnce({ fetch: privateFetch, close, destroy })
      .mockReturnValueOnce({ fetch: publicFetch, close, destroy });
  });

  afterEach(() => vi.useRealTimers());

  const build = (
    config = new ConfigService({}),
    allowlist: ReadonlySet<string> = new Set(),
  ) => new GuardedFetchService(config, allowlist, logger, shutdown);

  it('按厂商用途建两个池，并把 OUTBOUND_* 参数传给两者', () => {
    const service = build(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 7,
        OUTBOUND_CONNECT_TIMEOUT_MS: 900,
        SHUTDOWN_GRACE_MS: 15000,
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenNthCalledWith(1, {
      maxConnections: 7,
      connectTimeoutMs: 900,
      policy: { allowPrivateHosts: true },
    });
    expect(createGuardedFetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        maxConnections: 7,
        connectTimeoutMs: 900,
        policy: { allowPrivateHosts: false, allowedPrivateHosts: new Set() },
      }),
    );
    expect(service.fetch).toBe(privateFetch);
    expect(service.publicOnlyFetch).toBe(publicFetch);
  });

  it('已解析的私网白名单透传给仅公网池（由 CommonModule 统一解析）', () => {
    build(new ConfigService({}), new Set(['vllm.lan', '192.168.1.20']));

    expect(createGuardedFetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        policy: {
          allowPrivateHosts: false,
          allowedPrivateHosts: new Set(['vllm.lan', '192.168.1.20']),
        },
      }),
    );
  });

  it('仅公网池命中白名单时按 host / 解析地址去重写审计日志', () => {
    build();
    const options = (
      createGuardedFetchMock.mock.calls[1] as unknown[] | undefined
    )?.[0] as {
      onAllowlistedHost: (host: string) => void;
      onAllowlistedAddress: (address: string) => void;
    };

    options.onAllowlistedHost('vllm.lan');
    options.onAllowlistedHost('vllm.lan');
    options.onAllowlistedAddress('192.168.1.20');
    options.onAllowlistedAddress('192.168.1.20');

    expect(loggerWarnWith).toHaveBeenCalledTimes(2);
    expect(loggerWarnWith).toHaveBeenCalledWith(
      { host: 'vllm.lan' },
      '出站命中全局私网白名单',
      GuardedFetchService.name,
    );
    expect(loggerWarnWith).toHaveBeenCalledWith(
      { address: '192.168.1.20' },
      '出站命中全局私网白名单',
      GuardedFetchService.name,
    );
  });

  it('非法/缺失配置回退 undici 默认值（undefined）', () => {
    build(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 0,
        OUTBOUND_CONNECT_TIMEOUT_MS: 'abc',
        SHUTDOWN_GRACE_MS: 15000,
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        maxConnections: undefined,
        connectTimeoutMs: undefined,
      }),
    );
  });

  it('停机先优雅 close，再 destroy 收尾（两个池都处理）', async () => {
    const service = build();
    await service.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('close 失败也一定 destroy，并记录 warn', async () => {
    close.mockRejectedValue(new Error('close failed'));
    const service = build();

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('优雅关闭失败'),
      GuardedFetchService.name,
    );
  });

  it('close 被在途请求挂住时，超时后强制 destroy 并记录 warn', async () => {
    vi.useFakeTimers();
    close.mockReturnValue(new Promise<void>(() => {}));
    const service = build();

    const pending = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('强制销毁'),
      GuardedFetchService.name,
    );
  });

  it('剩余宽限期不足时跳过优雅等待，直接 destroy', async () => {
    remainingGraceMs.mockReturnValue(500);
    const service = build();

    await service.onApplicationShutdown();

    expect(close).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
