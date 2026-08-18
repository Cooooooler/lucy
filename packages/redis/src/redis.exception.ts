/**
 * 统一 Redis 业务异常：包装 ioredis 底层错误。
 * `code` 提供稳定的错误码，便于上层分类处理（默认 `REDIS_ERROR`）。
 */
export class RedisException extends Error {
  /** 稳定的错误分类码 */
  readonly code: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { cause: options?.cause });
    this.name = 'RedisException';
    this.code = options?.code ?? 'REDIS_ERROR';
  }
}

/** 将任意错误规范化为 RedisException；已是该类型则原样返回 */
export function toRedisException(error: unknown): RedisException {
  if (error instanceof RedisException) return error;
  const message =
    error instanceof Error ? error.message : 'Redis operation failed';
  return new RedisException(message, { cause: error });
}
