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
    this.ensureRunning();
    return this.probeDependencies();
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
  async liveness(): Promise<HealthResultDto> {
    // 存活探针刻意不探测依赖：依赖抖动不应触发 k8s 重启 Pod
    this.ensureRunning();
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
  // 就绪与完整健康检查探测同一组依赖，复用 check 以免两处实现漂移
  readiness(): Promise<HealthResultDto> {
    return this.check();
  }

  /** 停机中拒绝服务：抛 503，让探活方与网关及时摘除流量 */
  private ensureRunning(): void {
    if (this.shutdown.isShutdown()) {
      throw new ServiceUnavailableException('正在停机');
    }
  }

  /** 探测 DB 与 Redis：任一不可用返回 degraded 而非抛 500，便于区分整体宕机与部分降级 */
  private probeDependencies(): Promise<HealthResultDto> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
