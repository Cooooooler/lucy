import type { User } from '@/api/types';

// 角色层级：与后端 apps/backend/src/common/roles.ts 对齐（数值越大级别越高）。
// 前端仅做界面显隐与路由守卫，真正的权限由后端 RolesGuard 强制执行。
const ROLE_RANK = {
  user: 10,
  admin: 20,
  superadmin: 30,
} as const;

export type UserRole = keyof typeof ROLE_RANK;

/** 角色是否达到最低要求；未知/缺失角色一律按不通过处理（fail-closed）。 */
export function hasMinRole(
  role: User['role'] | undefined,
  min: UserRole,
): boolean {
  if (!role) return false;
  return (ROLE_RANK[role as UserRole] ?? -1) >= ROLE_RANK[min];
}
