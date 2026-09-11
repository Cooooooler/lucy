/**
 * 角色定义与层级（全序）：user < admin < superadmin。
 * 放在 common 而非 users 领域内，因为它同时被鉴权元数据（@Roles）、守卫与用户领域消费；
 * 若留在 users 领域，common 层的 @Roles 装饰器就得反向依赖领域模块。
 */
export enum UserRole {
  User = 'user',
  Admin = 'admin',
  SuperAdmin = 'superadmin',
}

/** 角色层级：数值越大级别越高，鉴权与操作权限均基于此比较（禁止用角色名字符串比较） */
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.User]: 10,
  [UserRole.Admin]: 20,
  [UserRole.SuperAdmin]: 30,
};

/** 取角色层级；未知角色返回 null，调用方必须按 fail-closed 处理，不可当作最低级别比较。 */
export function roleRank(role: string): number | null {
  return ROLE_RANK[role as UserRole] ?? null;
}
