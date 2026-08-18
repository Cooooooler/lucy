import { Test, type TestingModule } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

/** 共享连接配置：probe 与被测模块用同一 host/port（支持环境覆盖） */
const host = process.env.REDIS_HOST ?? '127.0.0.1';
const port = Number(process.env.REDIS_PORT ?? 6379);

/**
 * 探测 Redis 是否可用，带有限重试（CI 的 redis service 启动可能有短暂竞态）。
 * 任一尝试成功即返回 true。
 */
async function probeRedis(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = new Redis({
      host,
      port,
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 0,
    });
    try {
      await client.ping();
      await client.quit();
      return true;
    } catch {
      try {
        await client.disconnect();
      } catch {
        /* noop */
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
}

const redisAvailable = await probeRedis();
const inCi = process.env.CI === 'true' || Boolean(process.env.GITHUB_ACTIONS);

// 本地无 Redis 时跳过；CI 下不可用则整组运行并在 beforeAll 失败（不允许静默跳过）
describe.skipIf(!redisAvailable && !inCi)(
  'RedisService 集成（真实 Redis）',
  () => {
    let module: TestingModule;
    let service: RedisService;

    beforeAll(async () => {
      if (!redisAvailable) {
        throw new Error(
          'Redis unavailable: integration tests require a running Redis',
        );
      }
      module = await Test.createTestingModule({
        imports: [RedisModule.forRoot({ type: 'standalone', host, port })],
      }).compile();
      service = module.get(RedisService);
    });

    afterAll(async () => {
      await module.close();
    });

    it('set/get round-trip', async () => {
      const key = `it:str:${Date.now()}`;
      await service.set(key, 'value', 60);
      await expect(service.get(key)).resolves.toBe('value');
      await service.del(key);
    });

    it('setJson/getJson round-trip（含 Date 还原）', async () => {
      const key = `it:json:${Date.now()}`;
      const at = new Date('2026-08-16T10:00:00Z');
      await service.setJson(key, { a: 1, at }, 60);
      const value = await service.getJson<{ a: number; at: Date }>(key);
      expect(value?.a).toBe(1);
      expect(value?.at).toBeInstanceOf(Date);
      await service.del(key);
    });

    it('pipeline 批量执行', async () => {
      const key = `it:pipeline:${Date.now()}`;
      const pipeline = service.pipeline();
      pipeline.set(key, 'x');
      pipeline.get(key);
      const results = await pipeline.exec();
      expect(results?.[1]?.[1]).toBe('x');
      await service.del(key);
    });
  },
);
