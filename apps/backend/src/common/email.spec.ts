import { NORMALIZE_EMAIL_TRIM_CHARS } from '../db/migrations/1793491200000-NormalizeUserEmailCase.js';
import {
  EMAIL_TRIM_CHARS_SQL,
  isEmailAccount,
  normalizeEmail,
  USER_EMAIL_NORMALIZED_CHECK,
} from './email.js';

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

describe('isEmailAccount', () => {
  it.each([
    ['alice@example.com', true],
    ['alice', false],
    ['alice@team', true],
  ])('%s → %s', (account, expected) => {
    expect(isEmailAccount(account)).toBe(expected);
  });
});

describe('邮箱归一的 schema 契约', () => {
  // 迁移文件内联自己的字符集（保证历史语义不随运行时常量变化），
  // 这条断言防止两处悄然漂移：漏一个码点就只会让线上留下查不到的邮箱。
  it('迁移内联的空白字符集与运行时共用常量一致', () => {
    expect(NORMALIZE_EMAIL_TRIM_CHARS).toBe(EMAIL_TRIM_CHARS_SQL);
  });

  it('CHECK 表达式使用同一份空白字符集', () => {
    expect(USER_EMAIL_NORMALIZED_CHECK).toBe(
      `"email" = btrim(lower("email"), E'${EMAIL_TRIM_CHARS_SQL}')`,
    );
  });
});
