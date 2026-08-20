import { describe, expect, it } from 'vitest';
import { cn } from './utils';

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
