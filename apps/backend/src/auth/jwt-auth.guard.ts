import {
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import {
  HTTP_STATUS_MESSAGES,
  isFrameworkDefaultMessage,
} from '../common/messages.js';

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
    // 认证失败的文案归一：按异常类型/状态判断，不依赖文案字符串比较。
    // - validate() 里抛出的业务 HttpException（如「令牌已失效」401、
    //   将来可能的 403）原样透出，不丢状态码不改语义；
    // - passport 缺 token 等默认英文 `Unauthorized`（401 且文案是框架默认串）
    //   才换成可读中文；其他未知错误同样落 401 兜底，不透出技术细节。
    const [err, user] = args as unknown as [unknown, unknown];
    if (err || !user) {
      // getStatus() 返回 number 而非枚举：直接比 401，避免枚举比较规则误报
      if (
        err instanceof HttpException &&
        (err.getStatus() !== 401 || !isFrameworkDefaultMessage(err.message))
      ) {
        throw err;
      }
      throw new UnauthorizedException(HTTP_STATUS_MESSAGES[401]);
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
