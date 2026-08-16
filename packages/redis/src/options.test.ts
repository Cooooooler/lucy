import { describe, expect, it } from 'vitest';
import { defaultRetryStrategy, normalizeOptions } from './options.js';

describe('normalizeOptions', () => {
  it('合并生产默认参数', () => {
    const normalized = normalizeOptions({ type: 'standalone' });
    expect(normalized.maxRetriesPerRequest).toBe(20);
    expect(normalized.connectTimeout).toBe(10_000);
    expect(normalized.lazyConnect).toBe(true);
    expect(normalized.keepAlive).toBe(60_000);
  });

  it('用户显式覆盖默认参数', () => {
    const normalized = normalizeOptions({
      type: 'standalone',
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    expect(normalized.lazyConnect).toBe(false);
    expect(normalized.maxRetriesPerRequest).toBe(3);
  });

  it('未提供 retryStrategy 时注入默认指数退避', () => {
    const normalized = normalizeOptions({ type: 'standalone' });
    expect(normalized.retryStrategy).toBe(defaultRetryStrategy);
  });

  it('用户自定义 retryStrategy 被保留', () => {
    const custom = (times: number) => (times > 3 ? null : 100);
    const normalized = normalizeOptions({
      type: 'standalone',
      retryStrategy: custom,
    });
    expect(normalized.retryStrategy).toBe(custom);
  });

  it('保留连接模式字段', () => {
    const normalized = normalizeOptions({
      type: 'sentinel',
      sentinels: [{ host: 'a', port: 26379 }],
    });
    expect(normalized.type).toBe('sentinel');
  });
});

describe('defaultRetryStrategy', () => {
  it('指数退避并按上限封顶', () => {
    expect(defaultRetryStrategy(1)).toBe(50);
    expect(defaultRetryStrategy(50)).toBe(2_000);
  });
});
