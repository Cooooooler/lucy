/**
 * 登录账号是否按邮箱处理：`account` 接受用户名或邮箱二选一，含 `@` 即视为邮箱。
 *
 * 判据收在 auth 领域，`LoginDto` 的归一分支与 `AuthService.login` 的查询分流共用
 * 同一份实现——两处各写一次 `includes('@')` 时，任一处改成更严格的邮箱判据都会让
 * 另一处不同步（DTO 不归一而 service 仍走邮箱分支 → 大小写邮箱登录静默回到 401）。
 */
export function isEmailAccount(account: string): boolean {
  return account.includes('@');
}
