import { RedisService } from '@coool/redis-nest';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: '健康检查',
    description: '返回 DB 与 Redis 存活状态',
  })
  async check(): Promise<{
    status: string;
    db: boolean;
    redis: boolean;
  }> {
    // 任一组件不可用时报告 degraded 而非抛 500，便于探活方区分「整体宕机」与「部分降级」
    const [db, redis] = await Promise.all([
      this.dataSource
        .query('SELECT 1')
        .then(() => true)
        .catch(() => false),
      this.redis.raw
        .ping()
        .then((reply) => reply === 'PONG')
        .catch(() => false),
    ]);
    return { status: db && redis ? 'ok' : 'degraded', db, redis };
  }
}
