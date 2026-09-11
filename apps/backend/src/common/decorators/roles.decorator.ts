import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../roles.js';

/** 路由所需角色的元数据键，由 RolesGuard 读取 */
export const ROLES_KEY = 'roles';

/**
 * 标记路由所需角色：不标注则不做角色限制；标注后允许所列角色**及其以上级别**访问
 * （配合全局 RolesGuard）。参数限定为 UserRole，使角色名拼写错误在编译期即被发现
 * ——否则守卫会因无法识别该角色而拒绝，路由静默不可访问。
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
