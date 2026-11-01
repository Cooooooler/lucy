/**
 * `users.email` 的 schema 级约束定义（归属 users 领域，不放进 `common/`：
 * 表达式内联了 `"email"` 列名，只对这一张表成立）。
 *
 * JS `String.prototype.trim()` 会剥掉的空白字符集合，写成 Postgres `btrim` 的
 * 字符集参数（E'' 转义形式）。`btrim` 第二参数是「字符集合」，必须逐个列出；
 * Postgres 的 `\s` 只含 ASCII 空白，NBSP（U+00A0）、全角空格（U+3000）等不在内。
 *
 * 与 ECMAScript 的 WhiteSpace + LineTerminator 集合一致：TAB/LF/VT/FF/CR/SP、
 * U+00A0、U+1680、U+2000–U+200A、U+2028/2029、U+202F、U+205F、U+3000、U+FEFF。
 *
 * 迁移 `NormalizeUserEmailCase` 内联同一份字符集（迁移必须自包含，不能随运行时
 * 常量变动而改变历史语义）；`user-email.constraint.spec.ts` 会同时核对迁移字面量
 * 与最终 DDL，防止两处悄然漂移。
 */
export const EMAIL_TRIM_CHARS_SQL =
  '\\t\\n\\r\\f\\u000B \\u00A0\\u1680' +
  '\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A' +
  '\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF';

/**
 * `users.email` 的 schema 不变式：库中值必须等于 `normalizeEmail(value)`
 * （小写、无首尾空白）。实体上的 `@Check` 用它，`migration:generate` 据此产出约束，
 * 绕过应用层的写入（脚本 / 直接 SQL / 将来的改邮箱入口）也会被库拒绝。
 */
export const USER_EMAIL_NORMALIZED_CHECK = `"email" = btrim(lower("email"), E'${EMAIL_TRIM_CHARS_SQL}')`;
