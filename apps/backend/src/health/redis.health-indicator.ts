import { RedisService } from '@coool/redis-nest';
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async isHealthy(key = 'redis') {
    return this.indicators.check(key).attempt(async () => {
      const reply = await this.redis.raw.ping();
      if (reply !== 'PONG') throw new Error('Redis ping failed');
    });
  }
}
