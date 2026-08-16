/**
 * @coool/redis-nest 公共入口。
 * 连接管理：`RedisModule.forRoot/forRootAsync` 注册全局连接，`RedisService` 提供 CRUD 门面，
 * `RedisException` 统一异常，`REDIS_CLIENT` 为底层 client 的 DI token。
 * 详情见 README。
 */
export { createClient } from './client.factory.js';
export {
  DEFAULT_OPTIONS,
  defaultRetryStrategy,
  normalizeOptions,
} from './options.js';
export type {
  RedisClient,
  RedisClusterOptions,
  RedisConnectionOptions,
  RedisModuleOptions,
  RedisSentinelOptions,
  RedisStandaloneOptions,
} from './options.js';
export { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
export { RedisException, toRedisException } from './redis.exception.js';
export { RedisModule } from './redis.module.js';
export type { RedisModuleAsyncOptions } from './redis.module.js';
export { RedisService } from './redis.service.js';
export { defaultJsonSerializer, isIsoDateString } from './serializer.js';
export type { RedisSerializer } from './serializer.js';

export const REDIS_NEST_VERSION = '0.1.0';
