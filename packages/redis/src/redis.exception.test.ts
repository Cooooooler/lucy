import { describe, expect, it } from 'vitest';
import { RedisException, toRedisException } from './redis.exception.js';

describe('RedisException', () => {
  it('默认 code 为 REDIS_ERROR', () => {
    const e = new RedisException('boom');
    expect(e.name).toBe('RedisException');
    expect(e.code).toBe('REDIS_ERROR');
    expect(e.message).toBe('boom');
  });

  it('支持自定义 code 与 cause', () => {
    const cause = new Error('orig');
    const e = new RedisException('boom', { code: 'CONNECTION_BROKEN', cause });
    expect(e.code).toBe('CONNECTION_BROKEN');
    expect(e.cause).toBe(cause);
  });
});

describe('toRedisException', () => {
  it('已是指定类型则原样返回', () => {
    const e = new RedisException('x');
    expect(toRedisException(e)).toBe(e);
  });

  it('包装普通错误并保留 message 与 cause', () => {
    const orig = new Error('ECONNREFUSED');
    const wrapped = toRedisException(orig);
    expect(wrapped).toBeInstanceOf(RedisException);
    expect(wrapped.message).toBe('ECONNREFUSED');
    expect(wrapped.cause).toBe(orig);
  });
});
