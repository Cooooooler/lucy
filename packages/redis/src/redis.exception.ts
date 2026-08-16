export class RedisException extends Error {
  readonly code: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { cause: options?.cause });
    this.name = 'RedisException';
    this.code = options?.code ?? 'REDIS_ERROR';
  }
}

export function toRedisException(error: unknown): RedisException {
  if (error instanceof RedisException) return error;
  const message =
    error instanceof Error ? error.message : 'Redis operation failed';
  return new RedisException(message, { cause: error });
}
