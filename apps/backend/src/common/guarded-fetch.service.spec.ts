import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createGuardedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./guarded-fetch.js', () => ({
  createGuardedFetch: createGuardedFetchMock,
}));

import { GuardedFetchService } from './guarded-fetch.service.js';

describe('GuardedFetchService', () => {
  const close = vi.fn();
  const destroy = vi.fn();
  const fetchImpl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    destroy.mockResolvedValue(undefined);
    createGuardedFetchMock.mockReturnValue({
      fetch: fetchImpl,
      close,
      destroy,
    });
  });

  afterEach(() => vi.useRealTimers());

  it('把 OUTBOUND_* 配置传给连接池，并暴露同一份 fetch', () => {
    const service = new GuardedFetchService(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 7,
        OUTBOUND_CONNECT_TIMEOUT_MS: 900,
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenCalledWith({
      maxConnections: 7,
      connectTimeoutMs: 900,
    });
    expect(service.fetch).toBe(fetchImpl);
  });

  it('非法/缺失配置回退 undici 默认值（undefined）', () => {
    new GuardedFetchService(
      new ConfigService({
        OUTBOUND_MAX_CONNECTIONS: 0,
        OUTBOUND_CONNECT_TIMEOUT_MS: 'abc',
      }),
    );

    expect(createGuardedFetchMock).toHaveBeenCalledWith({
      maxConnections: undefined,
      connectTimeoutMs: undefined,
    });
  });

  it('停机先优雅 close，再 destroy 收尾', async () => {
    const service = new GuardedFetchService(new ConfigService({}));
    await service.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('close 失败也一定 destroy，不打断后续 shutdown hook', async () => {
    close.mockRejectedValue(new Error('close failed'));
    const service = new GuardedFetchService(new ConfigService({}));

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('close 被在途请求挂住时，超时后强制 destroy（不拖住 app.close）', async () => {
    vi.useFakeTimers();
    close.mockReturnValue(new Promise<void>(() => {}));
    const service = new GuardedFetchService(new ConfigService({}));

    const pending = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
