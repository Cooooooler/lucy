import type { Cluster, Redis } from 'ioredis';

export type RedisClient = Redis | Cluster;

export interface RedisConnectionOptions {
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  retryStrategy?: (times: number) => number | void | null;
}

export interface RedisStandaloneOptions extends RedisConnectionOptions {
  type: 'standalone';
  host?: string;
  port?: number;
}

export interface RedisSentinelOptions extends RedisConnectionOptions {
  type: 'sentinel';
  sentinels: { host: string; port: number }[];
  name?: string;
}

export interface RedisClusterOptions extends RedisConnectionOptions {
  type: 'cluster';
  clusterNodes: { host: string; port: number }[];
}

export type RedisModuleOptions =
  RedisStandaloneOptions | RedisSentinelOptions | RedisClusterOptions;

/** 生产默认参数（连接池/重试/重连/超时），可被用户选项覆盖 */
export const DEFAULT_OPTIONS = {
  maxRetriesPerRequest: 20,
  connectTimeout: 10_000,
  lazyConnect: true,
  keepAlive: 60_000,
};

/** 默认指数退避重连，上限 2s */
export function defaultRetryStrategy(times: number): number {
  return Math.min(times * 50, 2_000);
}

export type NormalizedRedisOptions = RedisModuleOptions & {
  retryStrategy: (times: number) => number | void | null;
};

export function normalizeOptions(
  options: RedisModuleOptions,
): NormalizedRedisOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    retryStrategy: options.retryStrategy ?? defaultRetryStrategy,
  } as NormalizedRedisOptions;
}
