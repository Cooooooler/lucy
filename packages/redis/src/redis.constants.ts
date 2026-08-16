/**
 * DI token：标识底层 ioredis 客户端实例。
 * `Symbol.for` 注册到全局符号表，保证多副本/多模块加载时解析到同一 token。
 */
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');
