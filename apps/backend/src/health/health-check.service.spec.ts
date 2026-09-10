import {
  HealthIndicatorService,
  HealthCheckService as TerminusHealthCheckService,
} from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { HealthCheckService } from './health-check.service.js';

describe('HealthCheckService', () => {
  let service: HealthCheckService;
  let terminus: { check: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    terminus = { check: vi.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        HealthCheckService,
        {
          provide: TerminusHealthCheckService,
          useValue: terminus,
        },
        { provide: HealthIndicatorService, useValue: {} },
      ],
    }).compile();
    service = module.get(HealthCheckService);
  });

  it('所有指标正常返回 ok', async () => {
    const result = await service.check([
      () => Promise.resolve('db-ok'),
      () => Promise.resolve('redis-ok'),
    ]);
    expect(result).toEqual({ status: 'ok', db: true, redis: true });
  });

  it('指标异常时探测各组件返回 degraded', async () => {
    // 让 terminus.check 抛出异常，触发 catch 分支进行逐个探测
    terminus.check.mockRejectedValueOnce(new Error('terminus failed'));
    const result = await service.check([
      () => Promise.reject(new Error('db down')),
      () => Promise.resolve('redis-ok'),
    ]);
    expect(result).toEqual({ status: 'degraded', db: false, redis: true });
  });

  it('空指标数组返回 ok', async () => {
    const result = await service.check([]);
    expect(result).toEqual({ status: 'ok', db: true, redis: true });
  });

  it('单个指标异常时正确标记', async () => {
    terminus.check.mockRejectedValueOnce(new Error('terminus failed'));
    const result = await service.check([
      () => Promise.reject(new Error('fail')),
    ]);
    expect(result).toEqual({ status: 'degraded', db: false, redis: true });
  });
});
