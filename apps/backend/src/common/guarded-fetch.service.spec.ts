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
  const fetchImpl = vi.fn();
  const loggerWarn = vi.fn();
  const remainingGraceMs = vi.fn(() => 15000);
  const logger = { warn: loggerWarn } as unknown as AppLogger;
  const shutdown = { remainingGraceMs } as unknown as ShutdownService;

  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    destroy.mockResolvedValue(undefined);
    remainingGraceMs.mockReturnValue(15000);
    createGuardedFetchMock.mockReturnValue({
      fetch: fetchImpl,
      close,
      destroy,
    });
  });

  afterEach(() => vi.useRealTimers());

  const build = (config = new ConfigService({})) =>
    new GuardedFetchService(config, logger, shutdown);

  it('把 OUTBOUND_* 配置传给连接池，并暴露同一份 fetch', () => {
    const service = build(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 7,
        OUTBOUND_CONNECT_TIMEOUT_MS: 900,
        SHUTDOWN_GRACE_MS: 15000,
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenCalledWith({
      maxConnections: 7,
      connectTimeoutMs: 900,
    });
    expect(service.fetch).toBe(fetchImpl);
  });

  it('非法/缺失配置回退 undici 默认值（undefined）', () => {
    build(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 0,
        OUTBOUND_CONNECT_TIMEOUT_MS: 'abc',
        SHUTDOWN_GRACE_MS: 15000,
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenCalledWith({
      maxConnections: undefined,
      connectTimeoutMs: undefined,
    });
  });

  it('停机先优雅 close，再 destroy 收尾', async () => {
    const service = build();
    await service.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('close 失败也一定 destroy，并记录 warn', async () => {
    close.mockRejectedValue(new Error('close failed'));
    const service = build();

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
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

    expect(destroy).toHaveBeenCalledTimes(1);
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
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
