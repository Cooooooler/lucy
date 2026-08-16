import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

const { mockRedisCtor } = vi.hoisted(() => ({ mockRedisCtor: vi.fn() }));

vi.mock('ioredis', () => {
  class MockRedis {
    quit = vi.fn();
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
});
