import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  getNamedClientToken,
  REDIS_CLIENT,
  REDIS_SERIALIZER,
} from './redis.constants.js';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';
import { defaultJsonSerializer, type RedisSerializer } from './serializer.js';

const { mockRedisCtor } = vi.hoisted(() => ({ mockRedisCtor: vi.fn() }));

vi.mock('ioredis', () => {
  class MockRedis {
    quit = vi.fn();
    get = vi.fn();
    set = vi.fn();
    del = vi.fn();
    exists = vi.fn();
    constructor(...args: unknown[]) {
      mockRedisCtor(...args);
    }
  }
  class MockCluster extends MockRedis {}
  return { Redis: MockRedis, Cluster: MockCluster };
});

describe('RedisModule', () => {
  it('forRoot 注册全局默认连接与 RedisService', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    expect(mockRedisCtor).toHaveBeenCalledTimes(1);
  });

  it('forRootAsync 通过 useFactory 构造连接', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          useFactory: () => ({ type: 'standalone', host: 'async.example.com' }),
        }),
      ],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('async.example.com');
  });

  it('forRootAsync 支持 inject 注入配置依赖', async () => {
    mockRedisCtor.mockClear();
    @Module({
      providers: [{ provide: 'CFG', useValue: { host: 'cfg.example.com' } }],
      exports: ['CFG'],
    })
    class CfgModule {}
    await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          imports: [CfgModule],
          inject: ['CFG'],
          useFactory: (cfg: { host: string }) => ({
            type: 'standalone',
            host: cfg.host,
          }),
        }),
      ],
    }).compile();
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('cfg.example.com');
  });

  it('forRootAsync 只调用一次 useFactory', async () => {
    mockRedisCtor.mockClear();
    let calls = 0;
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          useFactory: () => {
            calls++;
            return { type: 'standalone', host: 'h' };
          },
        }),
      ],
    }).compile();
    module.get(RedisService);
    expect(calls).toBe(1);
  });

  it('onModuleDestroy 关闭 client', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    await module.close();
    const client = module.get(REDIS_CLIENT) as {
      quit: ReturnType<typeof vi.fn>;
    };
    expect(client.quit).toHaveBeenCalled();
  });

  it('forRoot 默认提供 defaultJsonSerializer', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    expect(module.get(REDIS_SERIALIZER)).toBe(defaultJsonSerializer);
  });

  it('forRoot 支持自定义 serializer', async () => {
    mockRedisCtor.mockClear();
    const custom = { serialize: () => 'X', deserialize: () => 'Y' };
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({ type: 'standalone', serializer: custom }),
      ],
    }).compile();
    expect(module.get(REDIS_SERIALIZER)).toBe(custom);
  });

  it('forRootAsync useFactory 返回自定义 serializer', async () => {
    mockRedisCtor.mockClear();
    const custom = { serialize: () => 'X', deserialize: () => 'Y' };
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          useFactory: () => ({ type: 'standalone', serializer: custom }),
        }),
      ],
    }).compile();
    expect(module.get(REDIS_SERIALIZER)).toBe(custom);
  });

  it('forFeature name+options 创建独立命名连接并提供 RedisService', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forFeature({
          name: 'cache',
          options: {
            type: 'standalone',
            host: 'cache.example.com',
            port: 7000,
          },
        }),
      ],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    expect(mockRedisCtor).toHaveBeenCalledTimes(1);
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('cache.example.com');
    expect(arg.port).toBe(7000);
  });

  it('forFeature name 暴露命名客户端 token', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forFeature({
          name: 'cache',
          options: { type: 'standalone', host: 'cache.example.com' },
        }),
      ],
    }).compile();
    expect(module.get(getNamedClientToken('cache'))).toBeDefined();
  });

  it('forFeature name+namespace+options 组合可用', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forFeature({
          name: 'cache',
          namespace: 'auth',
          options: { type: 'standalone' },
        }),
      ],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    expect(mockRedisCtor).toHaveBeenCalledTimes(1);
  });

  it('forRoot + forFeature namespace：feature 服务覆盖全局（局部优先）', async () => {
    mockRedisCtor.mockClear();
    // 消费 feature RedisService 的服务放在 import forFeature 的 FeatureModule 里，
    // 验证它拿到的是 forFeature 提供的实例（局部 provider 优先于全局）
    const provided: { redis: unknown }[] = [];
    @Injectable()
    class Consumer {
      constructor(private readonly redis: RedisService) {
        provided.push({ redis });
      }
    }
    @Module({
      imports: [RedisModule.forFeature({ namespace: 'auth' })],
      providers: [Consumer],
    })
    class FeatureModule {}
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' }), FeatureModule],
    }).compile();
    module.get(Consumer);
    expect(mockRedisCtor).toHaveBeenCalledTimes(1); // 仅 forRoot 建连，feature 复用默认连接
    expect(provided[0].redis).toBeInstanceOf(RedisService);
  });

  it('forFeature 命名客户端使用 connOptions.serializer', async () => {
    mockRedisCtor.mockClear();
    const custom: RedisSerializer = {
      serialize: (v) => `C:${JSON.stringify(v)}`,
      deserialize: () => 'CUSTOM',
    };
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forFeature({
          name: 'cache',
          options: { type: 'standalone', serializer: custom },
        }),
      ],
    }).compile();
    const svc = module.get(RedisService);
    await svc.setJson('k', { a: 1 });
    const client = svc.raw as unknown as { set: ReturnType<typeof vi.fn> };
    expect(client.set).toHaveBeenCalledWith('k', 'C:{"a":1}');
  });

  it('forRoot + forFeature 命名客户端在关闭时 quit', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({ type: 'standalone' }),
        RedisModule.forFeature({
          name: 'cache',
          options: { type: 'standalone', host: 'cache.example.com' },
        }),
      ],
    }).compile();
    const named = module.get(getNamedClientToken('cache')) as {
      quit: ReturnType<typeof vi.fn>;
    };
    await module.close();
    expect(named.quit).toHaveBeenCalled();
  });
});
