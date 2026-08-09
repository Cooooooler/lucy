import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';

/**
 * `@nestjs/common` 的 `Sse` 装饰器写入的元数据键（值 `__sse__` 与官方
 * `@nestjs/common/constants` 中 `SSE_METADATA` 一致）。以字面量固化而非
 * deep import `@nestjs/common/constants`，因为该包无 exports 映射，
 * 在 nodenext + TS6 下无法通过类型解析。
 */
export const SSE_METADATA = '__sse__';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const isSse = Boolean(Reflect.getMetadata(SSE_METADATA, ctx.getHandler()));
    // SSE 事件帧为 {type,data}，逐帧包 {code,message,data} 信封会破坏流协议，
    // 故设计上放行 SSE 流，错误统一走 AllExceptionsFilter 异常信封机制
    if (isSse) return next.handle();
    return next
      .handle()
      .pipe(map((data: unknown) => ({ code: 0, message: 'ok', data })));
  }
}
