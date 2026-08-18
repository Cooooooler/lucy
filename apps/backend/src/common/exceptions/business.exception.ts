import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：把业务错误码与提示打包为 `{ code, message }`，由 AllExceptionsFilter
 * 统一输出为 `{ code, message, data: null }` 信封。code 取共享 ErrorCode 常量，
 * 与 HTTP status 解耦（同一业务码可映射不同 status，便于前端按 code 分类处理）。
 */
export class BusinessException extends HttpException {
  constructor(
    code: number,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}
