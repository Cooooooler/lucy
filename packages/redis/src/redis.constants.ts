/**
 * DI token：标识底层 ioredis 客户端实例。
 * `Symbol.for` 注册到全局符号表，保证多副本/多模块加载时解析到同一 token。
 */
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');

/** DI token：标识序列化器实例（默认 defaultJsonSerializer） */
export const REDIS_SERIALIZER = Symbol.for('REDIS_SERIALIZER');

/** 内部 DI token：forRootAsync 解析后的模块配置，供 client/serializer 派生（一次 useFactory） */
export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');

/** 生成命名客户端 DI token：`REDIS_CLIENT:<name>`（Symbol.for 全局共享，跨模块解析到同一实例） */
export function getNamedClientToken(name: string): symbol {
  return Symbol.for(`REDIS_CLIENT:${name}`);
}
