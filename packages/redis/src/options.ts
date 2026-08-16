import type { Cluster, Redis } from 'ioredis';

/** ioredis 客户端统一类型：单机/哨兵返回 Redis，集群返回 Cluster */
export type RedisClient = Redis | Cluster;

/** 所有连接模式共用的连接参数 */
export interface RedisConnectionOptions {
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  retryStrategy?: (times: number) => number | void | null;
}

/** 单机 Redis 连接配置 */
export interface RedisStandaloneOptions extends RedisConnectionOptions {
  type: 'standalone';
  host?: string;
  port?: number;
}

/** 哨兵模式连接配置 */
export interface RedisSentinelOptions extends RedisConnectionOptions {
  type: 'sentinel';
  sentinels: { host: string; port: number }[];
  name?: string;
}

/** Cluster 集群连接配置 */
export interface RedisClusterOptions extends RedisConnectionOptions {
  type: 'cluster';
  clusterNodes: { host: string; port: number }[];
}

/**
 * 连接模式判别联合：`type` 决定 createClient 构建 Redis 还是 Cluster。
 * `forRoot`/`forRootAsync` 的入参类型。
 */
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

/** normalizeOptions 的返回类型：保证 retryStrategy 必有默认值 */
export type NormalizedRedisOptions = RedisModuleOptions & {
  retryStrategy: (times: number) => number | void | null;
};

/** 合并生产默认参数与用户选项，用户未提供 retryStrategy 时注入默认指数退避 */
export function normalizeOptions(
  options: RedisModuleOptions,
): NormalizedRedisOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    retryStrategy: options.retryStrategy ?? defaultRetryStrategy,
  } as NormalizedRedisOptions;
}
