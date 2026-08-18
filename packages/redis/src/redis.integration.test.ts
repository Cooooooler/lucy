import { Test, type TestingModule } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

/** 探测本地 Redis 是否可用（CI 由 redis service 提供，本地常无） */
async function probeRedis(): Promise<boolean> {
  const client = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
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
    return false;
  }
}

const redisAvailable = await probeRedis();

describe.skipIf(!redisAvailable)('RedisService 集成（真实 Redis）', () => {
  let module: TestingModule;
  let service: RedisService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
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
});
