import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CommonModule } from '../common/common.module.js';
import { HealthCheckService } from './health-check.service.js';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';
import { TypeOrmHealthIndicator } from './typeorm.health-indicator.js';

@Module({
  imports: [TerminusModule, CommonModule],
  controllers: [HealthController],
  providers: [HealthCheckService, RedisHealthIndicator, TypeOrmHealthIndicator],
})
export class HealthModule {}
