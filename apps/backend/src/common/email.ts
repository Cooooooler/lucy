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
