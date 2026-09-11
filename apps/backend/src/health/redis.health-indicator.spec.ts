import { RedisService } from '@coool/redis-nest';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { RedisHealthIndicator } from './redis.health-indicator.js';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let indicatorService: { check: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const attempt = {
      attempt: vi.fn().mockResolvedValue(undefined),
    };
    indicatorService = {
      check: vi.fn().mockReturnValue(attempt),
    };

    const module = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        { provide: HealthIndicatorService, useValue: indicatorService },
        {
          provide: RedisService,
          useValue: { raw: { ping: vi.fn().mockResolvedValue('PONG') } },
        },
      ],
    }).compile();
    indicator = module.get(RedisHealthIndicator);
  });

  it('调用 isHealthy 时使用 redis key 执行 ping', async () => {
    await indicator.isHealthy();
    expect(indicatorService.check).toHaveBeenCalledWith('redis');
  });

  it('支持自定义 key', async () => {
    await indicator.isHealthy('custom-redis');
    expect(indicatorService.check).toHaveBeenCalledWith('custom-redis');
  });
});
