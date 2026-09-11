import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { roleRank } from '../users/user.entity.js';

/**
 * 角色守卫：读取 @Roles 元数据，按**层级**校验当前登录用户。
 * 语义为「所列角色级别**及以上**」——@Roles(Admin) 同时接受 admin 与 superadmin。
 * 未标注 @Roles 的路由直接放行。依赖 JwtAuthGuard 先行执行以填充 request.user；
 * role 缺失或未知（rank 0）时 fail-closed（拒绝），避免鉴权元数据被绕过。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    const actorRank = roleRank(request.user?.role ?? '');
    if (!required.some((role) => actorRank >= roleRank(role))) {
      throw new ForbiddenException('无权限访问');
    }
    return true;
  }
}
