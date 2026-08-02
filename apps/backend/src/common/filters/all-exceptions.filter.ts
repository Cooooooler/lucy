import { ErrorCode } from '@lucy/shared';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
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
      return res.status(status).json({ code, message, data: null });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.INTERNAL,
      message: '服务器内部错误',
      data: null,
    });
  }
}
