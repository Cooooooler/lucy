import { Cluster, Redis } from 'ioredis';
import {
  normalizeOptions,
  type NormalizedRedisOptions,
  type RedisClient,
  type RedisModuleOptions,
} from './options.js';

export function createClient(options: RedisModuleOptions): RedisClient {
  const normalized = normalizeOptions(options);
  switch (normalized.type) {
    case 'standalone':
      return new Redis({
        host: normalized.host ?? '127.0.0.1',
        port: normalized.port ?? 6379,
        ...buildCommonOptions(normalized),
      });
    case 'sentinel':
      return new Redis({
        sentinels: normalized.sentinels,
        name: normalized.name,
        ...buildCommonOptions(normalized),
      });
    case 'cluster':
      return new Cluster(normalized.clusterNodes, {
        redisOptions: buildCommonOptions(normalized),
      });
  }
}

function buildCommonOptions(options: NormalizedRedisOptions) {
  return {
    password: options.password,
    db: options.db,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    connectTimeout: options.connectTimeout,
    lazyConnect: options.lazyConnect,
    keepAlive: options.keepAlive,
    retryStrategy: options.retryStrategy,
  };
}
