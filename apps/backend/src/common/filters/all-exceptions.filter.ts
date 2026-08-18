import { ErrorCode } from '@lucy/shared';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
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
        );
      }
      return res.status(status).json({ code, message, data: null });
    }
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.INTERNAL,
      message: '服务器内部错误',
      data: null,
    });
  }
}
