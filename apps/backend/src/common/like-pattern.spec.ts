import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './like-pattern.js';

describe('escapeLikePattern', () => {
  it('普通关键字原样返回', () => {
    expect(escapeLikePattern('gpt-4o')).toBe('gpt-4o');
  });

  it('转义 % 与 _ 两个通配符', () => {
    expect(escapeLikePattern('50%_off')).toBe('50\\%\\_off');
  });

  it('反斜杠自身最先转义，避免 \\% 被当成字面量 %', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('拼进 %…% 后不含未转义通配符（除两侧的 %）', () => {
    const pattern = `%${escapeLikePattern('100%')}%`;
    expect(pattern).toBe('%100\\%%');
    // 去掉首尾的字面量 % 后，中间不应再有裸 %
    expect(pattern.slice(1, -1)).not.toMatch(/[^\\]%/);
  });
});
