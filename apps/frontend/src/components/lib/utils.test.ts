import { describe, expect, it } from 'vitest';
import { cn, formatBytes } from './utils';

describe('cn', () => {
  it('合并类名并去重', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('忽略假值（false/null/undefined）', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('用 tailwind-merge 解决类名冲突（保留后者）', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});

describe('formatBytes', () => {
  it('按 1024 进制给出人类可读大小（B 不带小数，其余保留 1 位）', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2 * 2.5)).toBe('2.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });

  it('非法输入兜底为 0 B（负数/NaN/Infinity）', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});
