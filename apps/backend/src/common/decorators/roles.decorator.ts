import { SetMetadata } from '@nestjs/common';

/** 路由所需角色的元数据键，由 RolesGuard 读取 */
export const ROLES_KEY = 'roles';

/** 标记路由所需角色：不标注则不做角色限制；标注后仅允许所列角色访问（配合全局 RolesGuard） */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
