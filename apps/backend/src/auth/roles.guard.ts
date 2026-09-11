import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { roleRank, type UserRole } from '../common/roles.js';

/**
 * 角色守卫：读取 @Roles 元数据，按**层级**校验当前登录用户。
 * 语义为「所列角色级别**及以上**」——@Roles(Admin) 同时接受 admin 与 superadmin。
 * 未标注 @Roles 的路由直接放行。依赖 JwtAuthGuard 先行执行以填充 request.user。
 *
 * 两处 fail-closed：
 * 1. @Roles 中出现无法识别的角色（拼写错误/脏元数据）→ 直接拒绝。若按「未知即最低级别」
 *    处理，阈值会退化为 0，导致任何已认证用户都能通过，鉴权静默失效；
 * 2. 当前用户 role 缺失或未知 → 拒绝。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const requiredRanks = required.map((role) => roleRank(role));
    if (requiredRanks.some((rank) => rank === null)) {
      throw new ForbiddenException('无权限访问');
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    const actorRank = roleRank(request.user?.role ?? '');
    const threshold = Math.min(...(requiredRanks as number[]));
    if (actorRank === null || actorRank < threshold) {
      throw new ForbiddenException('无权限访问');
    }
    return true;
  }
}
