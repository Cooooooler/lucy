import { ErrorCode } from '@lucy/shared';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map } from 'rxjs/operators';
import {
  SUCCESS_MESSAGE_KEY,
  type SuccessMessageResolver,
} from '../decorators/success-message.decorator.js';

/**
 * `@nestjs/common` 的 `Sse` 装饰器写入的元数据键（值 `__sse__` 与官方
 * `@nestjs/common/constants` 中 `SSE_METADATA` 一致）。以字面量固化而非
 * deep import `@nestjs/common/constants`，因为该包无 exports 映射，
 * 在 nodenext + TS6 下无法通过类型解析。
 */
export const SSE_METADATA = '__sse__';

/**
 * 未标注 `@SuccessMessage` 的变更路由按 HTTP 方法兜底，保证不会退化成 'ok'。
 * 查询类（GET 等）仍为 'ok'：读操作不产生用户提示，前端据此也不弹 toast。
 */
export function defaultSuccessMessage(method: string): string {
  switch (method) {
    case 'POST':
      return '操作成功';
    case 'PUT':
    case 'PATCH':
      return '更新成功';
    case 'DELETE':
      return '删除成功';
    default:
      return 'ok';
  }
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ApiResponseInterceptor.name);

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const isSse = Boolean(Reflect.getMetadata(SSE_METADATA, ctx.getHandler()));
    // SSE 事件帧为 {type,data}，逐帧包 {code,message,data} 信封会破坏流协议，
    // 故设计上放行 SSE 流，错误统一走 AllExceptionsFilter 异常信封机制
    if (isSse) return next.handle();
    const handler = ctx.getHandler();
    // Reflect.getMetadata 返回 any：先落 unknown 再收窄，避免 any 污染
    const rawDeclared: unknown =
      Reflect.getMetadata(SUCCESS_MESSAGE_KEY, handler) ??
      Reflect.getMetadata(SUCCESS_MESSAGE_KEY, ctx.getClass());
    const declared =
      typeof rawDeclared === 'string' || typeof rawDeclared === 'function'
        ? (rawDeclared as string | SuccessMessageResolver)
        : undefined;
    const request = ctx.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      map((data: unknown) => ({
        code: ErrorCode.OK,
        message: this.resolveMessage(declared, data, request),
        data,
      })),
    );
  }

  // 文案优先级：@SuccessMessage（静态或解析器）> 方法级兜底 > 'ok'。
  // 解析器抛错时记 warn 后回退方法级兜底：文案生成绝不能把一次成功响应变成 500，
  // 但载荷形状变化导致的反向文案必须让开发者看得见，否则用户看到错文案无人知晓。
  private resolveMessage(
    declared: string | SuccessMessageResolver | undefined,
    data: unknown,
    request: Request,
  ): string {
    if (typeof declared === 'function') {
      try {
        return declared(data, request);
      } catch (err) {
        this.logger.warn(
          `SuccessMessage 解析失败，回退方法兜底：${request.method} ${request.path} ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return defaultSuccessMessage(request.method);
      }
    }
    return declared ?? defaultSuccessMessage(request.method);
  }
}
