import { HttpException, UnauthorizedException } from '@nestjs/common';
import {
  HTTP_STATUS_MESSAGES,
  isFrameworkDefaultMessage,
} from '../common/messages.js';

/** 401 中文兜底：HTTP_STATUS_MESSAGES[401] 缺失时的编译期可见回退。 */
function unauthorizedMessage(): string {
  return HTTP_STATUS_MESSAGES[401] ?? '未登录或登录已过期';
}

/**
 * 认证失败归一（必抛 Error 子类）：按异常类型/状态判断，不依赖文案字符串比较。
 *
 * - validate() 抛出的业务 HttpException（如「令牌已失效」401、将来可能的
 *   403）原样透出，不丢状态码不改语义；
 * - passport 缺 token 等默认英文 `Unauthorized`（401 且文案是框架默认串）
 *   才换成可读中文；
 * - 非 HttpException 的 Error（如 Redis/DB 故障）直接原样抛出：全局
 *   AllExceptionsFilter 本来就输出 500 + ErrorCode.INTERNAL（50000）+
 *   完整请求上下文日志。在守卫里包一层 500 会丢业务码（变 `{ code: 500 }`）、
 *   再记一条日志造成一次故障两行告警；
 * - 入参收窄为 `Error | null | undefined`：passport 的 err 若是裸字符串等
 *   非 Error 值，在此统一收成中文 401（only-throw-error 要求只能抛 Error）。
 */
export function resolveAuthFailure(err: Error | null | undefined): never {
  if (err instanceof HttpException) {
    // getStatus() 返回 number 而非枚举：直接比 401，避免枚举比较规则误报
    const isDefault401 =
      err.getStatus() === 401 && isFrameworkDefaultMessage(err.message);
    if (!isDefault401) throw err;
    throw new UnauthorizedException(unauthorizedMessage());
  }
  if (err instanceof Error) throw err;
  throw new UnauthorizedException(unauthorizedMessage());
}
