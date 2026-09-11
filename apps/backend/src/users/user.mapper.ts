import type { components } from '@lucy/shared';
import { User } from './user.entity.js';

// API 契约类型由 Swagger 生成的 components.schemas 派生，与前端共享同一事实源
export type SharedUser = components['schemas']['User'];

/** 把用户实体映射为对外契约视图，剔除 passwordHash 等敏感字段。 */
export function toSharedUser(user: User): SharedUser {
  const { id, username, email, nickname, status, role, createdAt, updatedAt } =
    user;
  return {
    id,
    username,
    email,
    nickname,
    status,
    role,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
