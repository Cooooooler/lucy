import { Module } from '@nestjs/common';
import { DenylistService } from './denylist.service.js';

/**
 * 令牌撤销模块：提供 RedisBloom 布隆撤销服务。
 * 依赖 REDIS_CLIENT 与 ConfigService（均为全局提供），故此处仅声明自身 provider。
 */
@Module({
  providers: [DenylistService],
  exports: [DenylistService],
})
export class DenylistModule {}
