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
export { REDIS_CLIENT } from './redis.constants.js';
export { RedisException, toRedisException } from './redis.exception.js';
export { RedisModule } from './redis.module.js';
export type { RedisModuleAsyncOptions } from './redis.module.js';
export { RedisService } from './redis.service.js';

export const REDIS_NEST_VERSION = '0.1.0';
