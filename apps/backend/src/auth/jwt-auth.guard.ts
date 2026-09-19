import {
  ExecutionContext,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
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
  // AppLogger 需 DI 注入构造（ClsService + pino Logger），守卫内直接 new 不出来，
  // 此处用 Nest 原生 Logger（与 AllExceptionsFilter 一致），只记认证链路异常。
  private readonly logger = new Logger(JwtAuthGuard.name);

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
    //   才换成可读中文；
    // - 非 HttpException（如 Redis/DB 故障）绝不伪装成 401：记日志后按 500
    //   抛出，否则 401 不进过滤器的 5xx 日志分支，全链路无日志且告警失真。
    const [err, user] = args as unknown as [unknown, unknown];
    if (err || !user) {
      if (err instanceof HttpException) {
        // getStatus() 返回 number 而非枚举：直接比 401，避免枚举比较规则误报
        if (
          err.getStatus() !== 401 ||
          !isFrameworkDefaultMessage(err.message)
        ) {
          throw err;
        }
        throw new UnauthorizedException(unauthorizedMessage());
      }
      if (err) {
        // err 为 unknown：先收窄再取 stack/转字符串，避免 no-base-to-string 误报
        const trace =
          err instanceof Error
            ? (err.stack ?? err.message)
            : typeof err === 'string'
              ? err
              : JSON.stringify(err);
        this.logger.error(
          '认证链路异常（非 HttpException），按 500 抛出',
          trace,
        );
        throw new InternalServerErrorException(
          HTTP_STATUS_MESSAGES[500] ?? '服务器内部错误',
        );
      }
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

/** 401 中文兜底：HTTP_STATUS_MESSAGES[401] 缺失时的编译期可见回退。 */
function unauthorizedMessage(): string {
  return HTTP_STATUS_MESSAGES[401] ?? '未登录或登录已过期';
}
