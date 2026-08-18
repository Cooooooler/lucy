import { describe, expect, it } from 'vitest';
import { hashTag } from './hash-tag.js';

describe('hashTag', () => {
  it('生成 {key} 散列槽标签', () => {
    expect(hashTag('user:123')).toBe('{user:123}');
  });
  it('保留嵌套 key 原样包裹', () => {
    expect(hashTag('auth:refresh:abc')).toBe('{auth:refresh:abc}');
  });
  it('空字符串抛 TypeError（空花括号会被 Redis 忽略）', () => {
    expect(() => hashTag('')).toThrow(TypeError);
  });
  it('含花括号的 key 抛 TypeError（避免歧义标签）', () => {
    expect(() => hashTag('user:{123}')).toThrow(TypeError);
    expect(() => hashTag('a}b')).toThrow(TypeError);
  });
});
