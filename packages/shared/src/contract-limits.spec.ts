import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX_LENGTH,
  LOGIN_ACCOUNT_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from './index.js';

/**
 * 契约边界的回归网。
 *
 * 这些常量是前后端唯一的定义处（后端校验 + Swagger 文档选项、前端 zod + 输入框上限），
 * 之前各写一份时出现过真实漂移：后端把「特殊字符」从 ASCII 白名单放宽为符号判据，
 * 前端仍是旧白名单，`Str0ng-Pass` 在前端就被拦下。密码规则的判据尤其微妙（空白、零宽
 * 空格、汉字、换行位置都曾经是误判来源），故在此把语义逐条钉住——改判据必须连带改这里。
 */
describe('USERNAME_PATTERN', () => {
  it('只放行字母数字下划线连字符', () => {
    expect(USERNAME_PATTERN.test('lucy')).toBe(true);
    expect(USERNAME_PATTERN.test('A1')).toBe(true);
    expect(USERNAME_PATTERN.test('a_b-c')).toBe(true);
    expect(USERNAME_PATTERN.test('lu cy')).toBe(false);
    expect(USERNAME_PATTERN.test('lucy!')).toBe(false);
    expect(USERNAME_PATTERN.test('中文')).toBe(false);
  });

  it('无 m 标志时 `$` 只匹配输入末尾，不放过尾随换行', () => {
    // JS（与 Python 的 `$` 不同）在无 m 标志下不会把「末尾换行之前」当作匹配位置，
    // 因此这里不存在「lucy\n 被当成合法用户名、却永远登不进去」的漏洞。
    expect(USERNAME_PATTERN.test('lucy\n')).toBe(false);
    expect(USERNAME_PATTERN.test('\nlucy')).toBe(false);
  });
});

describe('长度边界', () => {
  it('登录 account 上界不小于邮箱上界（account 兼收用户名与邮箱两种形态）', () => {
    expect(LOGIN_ACCOUNT_MAX_LENGTH).toBeGreaterThanOrEqual(EMAIL_MAX_LENGTH);
  });

  it('下界为正且不大于上界', () => {
    expect(USERNAME_MIN_LENGTH).toBeGreaterThan(0);
    expect(USERNAME_MIN_LENGTH).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThan(0);
    expect(PASSWORD_MIN_LENGTH).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
  });
});

describe('PASSWORD_RULES', () => {
  it('符号判据只认符号/标点，不认空白、零宽字符与汉字', () => {
    expect(PASSWORD_RULES.symbol.test('!')).toBe(true);
    // `-` / `_` / `~` 是用户最可能写的「特殊字符」，旧白名单把它们排除在外
    expect(PASSWORD_RULES.symbol.test('-')).toBe(true);
    expect(PASSWORD_RULES.symbol.test('_')).toBe(true);
    expect(PASSWORD_RULES.symbol.test('~')).toBe(true);
    expect(PASSWORD_RULES.symbol.test(' ')).toBe(false);
    expect(PASSWORD_RULES.symbol.test('\t')).toBe(false);
    // U+200B（零宽空格，Cf）：不可见却非 `\s`，曾经能用来凑齐强度要求
    expect(PASSWORD_RULES.symbol.test('\u200b')).toBe(false);
    expect(PASSWORD_RULES.symbol.test('中')).toBe(false);
  });

  it('大小写与数字判据只认 ASCII', () => {
    expect(PASSWORD_RULES.uppercase.test('A')).toBe(true);
    expect(PASSWORD_RULES.lowercase.test('a')).toBe(true);
    expect(PASSWORD_RULES.digit.test('7')).toBe(true);
  });
});

describe('PASSWORD_PATTERN', () => {
  it('带 u 标志（符号判据用了 \\p{...} 属性转义）', () => {
    expect(PASSWORD_PATTERN.flags).toContain('u');
  });

  it('放行四项要素齐备的密码，含旧白名单拦下的 - _ ~', () => {
    expect(PASSWORD_PATTERN.test('Password1!')).toBe(true);
    expect(PASSWORD_PATTERN.test('Str0ng-Pass')).toBe(true);
    expect(PASSWORD_PATTERN.test('Password1_')).toBe(true);
    expect(PASSWORD_PATTERN.test('Aa1~bcde')).toBe(true);
  });

  it('缺任一要素即拒', () => {
    expect(PASSWORD_PATTERN.test('password1!')).toBe(false); // 无大写
    expect(PASSWORD_PATTERN.test('PASSWORD1!')).toBe(false); // 无小写
    expect(PASSWORD_PATTERN.test('Password!!')).toBe(false); // 无数字
    expect(PASSWORD_PATTERN.test('Password1')).toBe(false); // 无符号
  });

  it('首尾不接受空白（不用 trim，避免静默换掉待验证凭据）', () => {
    expect(PASSWORD_PATTERN.test(' Pass1!x')).toBe(false);
    expect(PASSWORD_PATTERN.test('Pass1!x ')).toBe(false);
  });

  it('内部换行不移除其后的字符判据（前瞻用 [\\s\\S]* 而非 .）', () => {
    // `.` 不匹配换行，若前瞻写成 `.*symbol`，换行之后的 `!` 会被看不见而误判「无符号」
    expect(PASSWORD_PATTERN.test('Aa1\nPass!')).toBe(true);
  });

  it('不可见字符与非符号字符不能充当「特殊字符」', () => {
    expect(PASSWORD_PATTERN.test('Str0ng\u200bPass')).toBe(false);
    expect(PASSWORD_PATTERN.test('密码密码Aa1')).toBe(false);
  });
});
