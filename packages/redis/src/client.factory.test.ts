import { describe, expect, it, vi } from 'vitest';

const { mockRedisCtor, mockClusterCtor } = vi.hoisted(() => ({
  mockRedisCtor: vi.fn(),
  mockClusterCtor: vi.fn(),
}));

vi.mock('ioredis', () => {
  class MockRedis {
    quit = vi.fn();
    constructor(...args: unknown[]) {
      mockRedisCtor(...args);
    }
  }
  class MockCluster extends MockRedis {
    constructor(...args: unknown[]) {
      super(...args);
      mockClusterCtor(...args);
    }
  }
  return { Redis: MockRedis, Cluster: MockCluster };
});

import { createClient } from './client.factory.js';
import { defaultRetryStrategy } from './options.js';

describe('createClient', () => {
  it('standalone 构建单机 Redis，带生产默认参数', () => {
    mockRedisCtor.mockClear();
    createClient({ type: 'standalone' });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('127.0.0.1');
    expect(arg.port).toBe(6379);
    expect(arg.lazyConnect).toBe(true);
    expect(arg.maxRetriesPerRequest).toBe(20);
    expect(arg.retryStrategy).toBe(defaultRetryStrategy);
  });

  it('standalone 尊重用户 host/port', () => {
    mockRedisCtor.mockClear();
    createClient({ type: 'standalone', host: 'r.example.com', port: 7000 });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('r.example.com');
    expect(arg.port).toBe(7000);
  });

  it('sentinel 透传 sentinels 与 name', () => {
    mockRedisCtor.mockClear();
    createClient({
      type: 'sentinel',
      sentinels: [{ host: 's1', port: 26379 }],
      name: 'mymaster',
    });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.sentinels).toEqual([{ host: 's1', port: 26379 }]);
    expect(arg.name).toBe('mymaster');
  });

  it('cluster 走 Cluster 构造，公共参数放 redisOptions', () => {
    mockClusterCtor.mockClear();
    createClient({
      type: 'cluster',
      clusterNodes: [{ host: 'c1', port: 7001 }],
    });
    const [nodes, opts] = mockClusterCtor.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(nodes).toEqual([{ host: 'c1', port: 7001 }]);
    expect((opts.redisOptions as Record<string, unknown>).lazyConnect).toBe(
      true,
    );
  });
});
