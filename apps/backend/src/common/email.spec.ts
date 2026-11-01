import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it.each([
    ['大小写', 'Alice@Example.COM', 'alice@example.com'],
    ['首尾空格', ' alice@example.com ', 'alice@example.com'],
    // 迁移/CHECK 的字符集必须覆盖 JS trim 的 Unicode 空白，否则库中会留下登录不到的账号
    ['NBSP', '\u00A0alice@example.com\u00A0', 'alice@example.com'],
    ['全角空格', '\u3000alice@example.com\u3000', 'alice@example.com'],
  ])('%s 被归一为小写且去首尾空白', (_label, input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('不删除内部空白（只 trim 首尾）', () => {
    expect(normalizeEmail(' alice @ example.com ')).toBe('alice @ example.com');
  });
});
