import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createGuardedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./guarded-fetch.js', () => ({
  createGuardedFetch: createGuardedFetchMock,
}));

import { GuardedFetchService } from './guarded-fetch.service.js';

describe('GuardedFetchService', () => {
  const close = vi.fn();
  const fetchImpl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createGuardedFetchMock.mockReturnValue({ fetch: fetchImpl, close });
  });

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

  it('停机时关闭连接池', async () => {
    const service = new GuardedFetchService(new ConfigService({}));
    await service.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
