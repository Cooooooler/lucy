import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import { TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { SSE_METADATA } from '../sse-metadata.js';

/**
 * 请求处理超时：给非 SSE 的处理器套一层 rxjs `timeout`，避免单个卡死的处理器 / 下游依赖
 * 无限期占用连接。Node 的 `server.requestTimeout` 只覆盖请求头/体的读取，不覆盖处理器执行，
 * 缺少这层时「处理器自身挂起」没有任何上界。
 *
 * - SSE（带 `@SetMetadata(SSE_METADATA, true)` 的处理器）放行：它按设计长时间保持连接、
 *   分段流式输出，超时机制会误杀正常的长回答（与 `ApiResponseInterceptor` 的放行同一判据）。
 * - 阈值取 `REQUEST_TIMEOUT_MS`（默认 120s）；非有限值或 <= 0 视为禁用，便于按需关闭。
 * - 超时抛 `RequestTimeoutException`（408），文案由全局 `AllExceptionsFilter` 统一成中文信封。
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isSse = Boolean(
      Reflect.getMetadata(SSE_METADATA, context.getHandler()),
    );
    const ms = Number(this.config.get('REQUEST_TIMEOUT_MS', 120000));
    if (isSse || !Number.isFinite(ms) || ms <= 0) {
      return next.handle();
    }
    return next.handle().pipe(
      timeout(ms),
      catchError((err: unknown) =>
        err instanceof TimeoutError
          ? throwError(() => new RequestTimeoutException('请求处理超时'))
          : throwError(() => err),
      ),
    );
  }
}
