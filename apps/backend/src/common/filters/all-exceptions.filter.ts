import { ErrorCode } from '@lucy/shared';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import {
  FRAMEWORK_DEFAULT_MESSAGES,
  HTTP_STATUS_MESSAGES,
} from '../messages.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<
      Request & { user?: { userId?: string }; id?: string }
    >();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as
        { code?: number; message?: string | string[] } | string;
      const code = typeof body === 'object' && body.code ? body.code : status;
      const raw: string =
        typeof body === 'object'
          ? firstMessage(body.message, exception.message)
          : body;
      const message = readableErrorMessage(raw, status);
      if (status >= 500) {
        this.logger.error(
          `HttpException ${status}: ${message}`,
          exception.stack,
          this.logContext(req),
        );
      }
      return res.status(status).json({ code, message, data: null });
    }
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
      this.logContext(req),
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.INTERNAL,
      message: '服务器内部错误',
      data: null,
    });
  }

  // 结构化错误上下文：请求方法/路径/用户/traceId，便于按链路检索。
  // userId 优先取 CLS（守卫写入），req.user 兜底；绝不记录请求体（可能含密码/token）。
  // 路径只取 pathname：req.url 携带 query string，若接口把凭证放 query（如 EventSource
  // 无法自定义 header 时的 ?token=），整串落盘会泄露，故丢弃 ? 之后的部分。
  private logContext(req: {
    method?: string;
    url?: string;
    user?: { userId?: string };
    id?: string;
  }): string {
    const userId = this.clsUserId() ?? req.user?.userId ?? '-';
    const pathname = (req.url ?? '-').split('?')[0];
    return `${req.method ?? '-'} ${pathname} user=${userId} reqId=${req.id ?? '-'}`;
  }

  private clsUserId(): string | null {
    try {
      if (!this.cls.isActive()) return null;
      return this.cls.get<string | null>('userId') ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * 取异常体的第一条 message：数组取首项（可能为空数组），缺失时回退
 * exception 自身的 message。抽成独立函数，避免嵌套三元（S3358）。
 */
function firstMessage(
  message: string | string[] | undefined,
  fallback: string,
): string {
  if (Array.isArray(message)) return message[0] ?? '';
  return message ?? fallback;
}

/**
 * 失败原因统一可读化。业务中文文案原样透出；以下三种情况换成中文兜底：
 * 1. message 为空 —— 直接给状态兜底，避免前端拿到空串无话可说；
 * 2. 命中框架英文默认串（如 passport 的 `Unauthorized`、限流的 `Too Many Requests`）；
 * 3. Nest 路由缺失的 `Cannot GET /x` —— 翻译成「请求的资源不存在」。
 *
 * 注意不拦截未收录的英文：那是业务代码自己写的英文，没有语境不敢乱改；
 * 逐案发现、逐案在各 service 里改成中文即可。
 */
export function readableErrorMessage(raw: string, status: number): string {
  const normalized = raw.trim();
  if (!normalized) return HTTP_STATUS_MESSAGES[status] ?? '请求失败';
  if (FRAMEWORK_DEFAULT_MESSAGES.has(normalized)) {
    return HTTP_STATUS_MESSAGES[status] ?? '请求失败';
  }
  if (/^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(normalized)) {
    return HTTP_STATUS_MESSAGES[404] ?? '请求的资源不存在';
  }
  return raw;
}
