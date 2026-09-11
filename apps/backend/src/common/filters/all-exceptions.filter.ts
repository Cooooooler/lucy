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
      let message: string | string[];
      if (typeof body === 'object') {
        message = Array.isArray(body.message)
          ? body.message[0]
          : (body.message ?? exception.message);
      } else {
        message = body;
      }
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
