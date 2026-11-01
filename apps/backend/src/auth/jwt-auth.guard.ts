import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { unauthorizedMessage } from '../common/messages.js';

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
  // 签名保持与 passport AuthGuard 兼容（any 参数），内部收窄类型。

  handleRequest<TUser>(
    ...args: [any, any, any, ExecutionContext, any?]
  ): TUser {
    const [err] = args as unknown as [unknown, unknown];
    // 守卫只做类型收窄：passport 约定 err 为 Error，但裸字符串等非 Error 值不能直接抛
    // （only-throw-error），统一收成中文 401。Error 一律原样交回 super.handleRequest 抛出：
    // 业务中文异常、403、Redis/DB 故障语义都不在此改写；框架英文默认串（如 passport 的
    // `Unauthorized`）的中文化只由全局 AllExceptionsFilter 的 readableErrorMessage 实现，
    // 守卫不再保留第二份文案归一逻辑（两份实现曾各测一遍、结论也一致）。
    if (err !== null && err !== undefined && !(err instanceof Error)) {
      // 文案取自 messages.ts 的单一出口，不在守卫里再存一份字面量
      throw new UnauthorizedException(unauthorizedMessage());
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
