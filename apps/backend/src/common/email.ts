/**
 * 邮箱归一：去除首尾空白并转小写。
 *
 * 邮箱按 RFC 局部部分理论上区分大小写，但现实中的邮件服务商一律不区分，
 * 用户也不会记得自己注册时的大小写。仓库此前按原样存储、按大小写敏感查询，
 * 于是 `Alice@Example.com` 与 `alice@example.com` 可注册成两个账号，本人用小写登录还会 401。
 *
 * 约定：`users.email` 只存归一后的值（注册 DTO、`UsersService.create` 都经过这里）；
 * 登录侧把「含 @ 的 account」同样归一后再查。三处共用这一个函数，避免各写一份后漂移。
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 登录账号是否按邮箱处理：`account` 接受用户名或邮箱二选一，含 `@` 即视为邮箱。
 *
 * 判据收在这里，DTO 的归一分支与 `AuthService.login` 的查询分流共用同一份实现——
 * 两处各写一次 `includes('@')` 时，任一处改成更严格的邮箱判据都会让另一处不同步
 * （DTO 不归一而 service 仍走邮箱分支 → 大小写邮箱登录静默回到 401）。
 */
export function isEmailAccount(account: string): boolean {
  return account.includes('@');
}

/**
 * JS `String.prototype.trim()` 会剥掉的空白字符集合，写成 Postgres `btrim` 的
 * 字符集参数（E'' 转义形式）。`btrim` 第二参数是「字符集合」，必须逐个列出；
 * Postgres 的 `\s` 只含 ASCII 空白，NBSP（U+00A0）、全角空格（U+3000）等不在内。
 *
 * 与 ECMAScript 的 WhiteSpace + LineTerminator 集合一致：TAB/LF/VT/FF/CR/SP、
 * U+00A0、U+1680、U+2000–U+200A、U+2028/2029、U+202F、U+205F、U+3000、U+FEFF。
 *
 * 迁移 `NormalizeUserEmailCase` 内联同一份字符集（迁移必须自包含，不能随运行时代码
 * 变动而改变历史语义）；`email.spec.ts` 用一条断言钉住两份字面量一致。
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
