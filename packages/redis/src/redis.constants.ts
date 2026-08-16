/**
 * DI token：标识底层 ioredis 客户端实例。
 * `Symbol.for` 注册到全局符号表，保证多副本/多模块加载时解析到同一 token。
 */
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');

/** DI token：标识序列化器实例（默认 defaultJsonSerializer） */
export const REDIS_SERIALIZER = Symbol.for('REDIS_SERIALIZER');
