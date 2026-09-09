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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

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
  // 注意绝不记录请求体（可能含密码/token），只记定位所需的最小字段。
  private logContext(req: {
    method?: string;
    url?: string;
    user?: { userId?: string };
    id?: string;
  }): string {
    const userId = req.user?.userId ?? '-';
    return `${req.method ?? '-'} ${req.url ?? '-'} user=${userId} reqId=${req.id ?? '-'}`;
  }
}
