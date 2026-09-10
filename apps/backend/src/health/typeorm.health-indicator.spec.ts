import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TypeOrmHealthIndicator } from './typeorm.health-indicator.js';

describe('TypeOrmHealthIndicator', () => {
  let indicator: TypeOrmHealthIndicator;
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
        TypeOrmHealthIndicator,
        { provide: HealthIndicatorService, useValue: indicatorService },
        {
          provide: DataSource,
          useValue: { query: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    indicator = module.get(TypeOrmHealthIndicator);
  });

  it('调用 isHealthy 时使用 database key 执行查询', async () => {
    await indicator.isHealthy();
    expect(indicatorService.check).toHaveBeenCalledWith('database');
  });

  it('支持自定义 key', async () => {
    await indicator.isHealthy('custom-db');
    expect(indicatorService.check).toHaveBeenCalledWith('custom-db');
  });
});
