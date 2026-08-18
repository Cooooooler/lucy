import { describe, expect, it } from 'vitest';
import { hashTag } from './hash-tag.js';

describe('hashTag', () => {
  it('生成 {key} 散列槽标签', () => {
    expect(hashTag('user:123')).toBe('{user:123}');
  });
  it('保留嵌套 key 原样包裹', () => {
    expect(hashTag('auth:refresh:abc')).toBe('{auth:refresh:abc}');
  });
  it('空字符串包裹为 {}', () => {
    expect(hashTag('')).toBe('{}');
  });
});
