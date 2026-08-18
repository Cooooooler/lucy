import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** JwtStrategy.validate 写入请求对象的用户负载：userId + JWT 的 jti（用于登出撤销） */
export interface CurrentUserPayload {
  userId: string;
  jti: string;
}

/** 从请求注入当前登录用户；仅在受 JwtAuthGuard 保护的路由中可用，否则 user 为 undefined */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>().user;
  },
);
