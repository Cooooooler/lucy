import { describe, expect, it } from 'vitest';
import { resolveCorsOrigin } from './cors.js';

describe('resolveCorsOrigin', () => {
  it('未配置时返回 false（仅同源，不开放 CORS）', () => {
    expect(resolveCorsOrigin(undefined)).toBe(false);
    expect(resolveCorsOrigin('')).toBe(false);
  });

  it('单个 origin 返回白名单数组', () => {
    expect(resolveCorsOrigin('https://app.example.com')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('逗号分隔多个 origin 并去空格', () => {
    expect(resolveCorsOrigin('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});
