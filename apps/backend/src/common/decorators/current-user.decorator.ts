import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * JwtStrategy.validate 写入请求对象的用户负载：userId + JWT 的 jti（用于登出撤销）
 * + role（角色鉴权，由 RolesGuard 校验）。role 保持 string 而非 UserRole，因为它是
 * 令牌/库中的原始值，需先经 roleRank 校验识别后才用于层级判断。
 */
export interface CurrentUserPayload {
  userId: string;
  jti: string;
  role: string;
}

/** 从请求注入当前登录用户；仅在受 JwtAuthGuard 保护的路由中可用，否则 user 为 undefined */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>().user;
  },
);
