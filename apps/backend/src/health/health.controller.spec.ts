import { RedisService } from '@coool/redis-nest';
import {
  HealthIndicatorService,
  HealthCheckService as TerminusHealthCheckService,
} from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ShutdownService } from '../common/shutdown.service.js';
import { HealthCheckService } from './health-check.service.js';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';
import { TypeOrmHealthIndicator } from './typeorm.health-indicator.js';

describe('HealthController', () => {
  const dataSource = { query: vi.fn() };
  const redis = { raw: { ping: vi.fn() } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function build(shutdown = false): Promise<HealthController> {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
        { provide: ShutdownService, useValue: { isShutdown: () => shutdown } },
        { provide: TerminusHealthCheckService, useValue: {} },
        { provide: HealthIndicatorService, useValue: {} },
        HealthCheckService,
        RedisHealthIndicator,
        TypeOrmHealthIndicator,
      ],
    })
      .overrideProvider(HealthCheckService)
      .useValue({
        check: () => Promise.resolve({ status: 'ok', db: true, redis: true }),
      })
      .compile();
    return module.get(HealthController);
  }

  it('DB 与 Redis 均可用返回 ok', async () => {
    const controller = await build();
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: true,
      redis: true,
    });
  });

  it('停机期间抛 503', async () => {
    const controller = await build(true);
    await expect(controller.check()).rejects.toThrow('正在停机');
  });

  describe('liveness 存活探针', () => {
    it('进程存活时返回 ok', async () => {
      const controller = await build();
      await expect(controller.liveness()).resolves.toEqual({
        status: 'ok',
        db: true,
        redis: true,
      });
    });

    it('停机期间抛 503', async () => {
      const controller = await build(true);
      await expect(controller.liveness()).rejects.toThrow('正在停机');
    });
  });

  describe('readiness 就绪探针', () => {
    it('DB 与 Redis 均可用返回 ok', async () => {
      const controller = await build();
      await expect(controller.readiness()).resolves.toEqual({
        status: 'ok',
        db: true,
        redis: true,
      });
    });

    it('停机期间抛 503', async () => {
      const controller = await build(true);
      await expect(controller.readiness()).rejects.toThrow('正在停机');
    });
  });
});
