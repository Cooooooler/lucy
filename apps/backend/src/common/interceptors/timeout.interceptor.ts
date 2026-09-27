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
import { AppLogger } from '../app-logger.service.js';
import { SSE_METADATA } from '../sse-metadata.js';

/**
 * 只对读方法（HTTP 安全方法）设超时。写方法（POST/PUT/PATCH/DELETE）超时属于「半途失败」：
 * rxjs `timeout` 只取消订阅，既不会取消正在执行的处理器，也不会回滚已开启的事务，客户端拿到
 * 408 后重试可能重复落库/重复上传，而服务端这次执行仍会跑完。文件上传（POST）还会把 multipart
 * 读体时间计入阈值而误杀，SSE 端点同样是 POST —— 都因不属安全方法而天然排除。
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 读请求处理超时：给 GET/HEAD/OPTIONS 处理器套一层 rxjs `timeout`，避免卡死的查询无限期
 * 占用连接。Node 的 `server.requestTimeout` 只覆盖请求头/体的读取，不覆盖处理器执行，缺少
 * 这层时「读处理器自身挂起」没有任何上界。
 *
 * - 阈值取 `REQUEST_TIMEOUT_MS`（默认 120s）；`<=0` 视为禁用。
 * - 超时抛**不带 message** 的 `RequestTimeoutException`：文案由全局 `AllExceptionsFilter`
 *   按 408 归一（错误文案只在 `messages.ts` 定义，勿在拦截器里硬编码，否则与之互相架空）。
 * - 超时前记一条 warn：408 不进 `AllExceptionsFilter` 的日志（它只记 >=500），且 rxjs 取消
 *   订阅后处理器后续的真实错误会被静默丢弃——不记这条就分不清「卡住后超时」与「仍在挂起」，
 *   根因（如 DB 报错）也无人可见。
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // SSE 显式放行（与 ApiResponseInterceptor 同一判据）：不能只依赖「SSE 端点是 POST」
    // 这一隐含前提——EventSource 只支持 GET，若流式端点改回 GET 或新增流式 GET，
    // 超时会静默掐断长回答
    const isSse = Boolean(
      Reflect.getMetadata(SSE_METADATA, context.getHandler()),
    );
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    if (isSse || !SAFE_METHODS.has(request.method ?? '')) {
      return next.handle();
    }
    // getOrThrow 只保证键存在、不保证类型（ConfigService 可能是字符串），故显式 Number 归一；
    // 默认值只在 env schema 定义一次，此处不重复兜底
    const ms = Number(this.config.getOrThrow('REQUEST_TIMEOUT_MS'));
    if (!Number.isFinite(ms) || ms <= 0) {
      return next.handle();
    }
    return next.handle().pipe(
      timeout(ms),
      catchError((err: unknown) => {
        if (!(err instanceof TimeoutError)) {
          return throwError(() => err);
        }
        // 路径只取 pathname：req.url 可能带 query string（其中或有凭证）
        const pathname = (request.url ?? '-').split('?')[0];
        this.logger.warn(
          `请求处理超时（${ms}ms）：${request.method ?? '-'} ${pathname}`,
          TimeoutInterceptor.name,
        );
        return throwError(() => new RequestTimeoutException());
      }),
    );
  }
}
