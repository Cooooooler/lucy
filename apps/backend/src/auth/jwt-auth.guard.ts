import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // passport 验证通过后把 userId 写入 CLS：同一请求内后续所有
  // AppLogger 日志自动带上 user=xxx，无需各 service 手工拼接。
  // 签名保持与 passport AuthGuard 兼容（any 参数），内部收窄 userId 类型。

  handleRequest<TUser>(
    ...args: [any, any, any, ExecutionContext, any?]
  ): TUser {
    // passport 默认报错是英文 `Unauthorized`：无 token 或认证失败时换成可读中文。
    // validate() 里抛出的业务异常（如「令牌已失效」「账号不可用」）原样透出不动。
    // 参数签名须与 passport AuthGuard 兼容（any）：先落 unknown 元组再解构，避免 any 污染。
    const [err, user] = args as unknown as [unknown, unknown];
    if (err || !user) {
      throw err instanceof UnauthorizedException &&
        err.message !== 'Unauthorized'
        ? err
        : new UnauthorizedException('未登录或登录已过期');
    }
    // super.handleRequest 返回 any：先落 unknown 再断言，避免 any 污染
    const raw: unknown = super.handleRequest(...args);
    const result = raw as TUser;
    try {
      const userId = (result as { userId?: unknown }).userId;
      if (this.cls.isActive()) {
        this.cls.set('userId', typeof userId === 'string' ? userId : null);
      }
    } catch {
      // CLS 未激活（如单测直调）时忽略，不影响认证主流程
    }
    return result;
  }
}
