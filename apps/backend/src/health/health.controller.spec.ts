import { RedisService } from '@coool/redis-nest';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const dataSource = { query: vi.fn() };
  const redis = { raw: { ping: vi.fn() } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function build(): Promise<HealthController> {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    return module.get(HealthController);
  }

  it('DB 与 Redis 均可用返回 ok', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.raw.ping.mockResolvedValue('PONG');
    const controller = await build();
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: true,
      redis: true,
    });
  });

  it('DB 不可用返回 degraded', async () => {
    dataSource.query.mockRejectedValue(new Error('down'));
    redis.raw.ping.mockResolvedValue('PONG');
    const controller = await build();
    await expect(controller.check()).resolves.toEqual({
      status: 'degraded',
      db: false,
      redis: true,
    });
  });

  it('Redis 不可用返回 degraded', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.raw.ping.mockRejectedValue(new Error('down'));
    const controller = await build();
    await expect(controller.check()).resolves.toEqual({
      status: 'degraded',
      db: true,
      redis: false,
    });
  });
});
