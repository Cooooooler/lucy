import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { ShutdownService } from '../common/shutdown.service.js';
import { HealthResultDto } from './dto/health-result.dto.js';
import { HealthCheckService } from './health-check.service.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';
import { TypeOrmHealthIndicator } from './typeorm.health-indicator.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly shutdown: ShutdownService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  @HealthCheck({ swaggerDocumentation: false })
  @ApiOperation({
    summary: '健康检查',
    description: '返回 DB 与 Redis 存活状态（停机期间返回 503）',
  })
  @ApiOkResponse({ description: '健康状态', type: HealthResultDto })
  async check(): Promise<HealthResultDto> {
    if (this.shutdown.isShutdown()) {
      return Promise.reject(new ServiceUnavailableException('正在停机'));
    }
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }

  @Public()
  @SkipThrottle()
  @Get('live')
  @HealthCheck({ swaggerDocumentation: false })
  @ApiOperation({
    summary: '存活探针',
    description: 'k8s liveness：进程是否存活',
  })
  @ApiOkResponse({ description: '存活', type: HealthResultDto })
  liveness(): Promise<HealthResultDto> {
    if (this.shutdown.isShutdown()) {
      return Promise.reject(new ServiceUnavailableException('正在停机'));
    }
    return this.health.check([]);
  }

  @Public()
  @SkipThrottle()
  @Get('ready')
  @HealthCheck({ swaggerDocumentation: false })
  @ApiOperation({
    summary: '就绪探针',
    description: 'k8s readiness：能否承接流量',
  })
  @ApiOkResponse({ description: '就绪', type: HealthResultDto })
  readiness(): Promise<HealthResultDto> {
    if (this.shutdown.isShutdown()) {
      return Promise.reject(new ServiceUnavailableException('正在停机'));
    }
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
