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
import { isSseHandler } from '../sse-metadata.js';

/**
 * 只对读方法（HTTP 安全方法）设超时。写方法（POST/PUT/PATCH/DELETE）超时属于「半途失败」：
 * rxjs `timeout` 只取消订阅，既不会取消正在执行的处理器，也不会回滚已开启的事务，客户端拿到
 * 408 后重试可能重复落库/重复上传，而服务端这次执行仍会跑完。文件上传（POST）还会把 multipart
 * 读体时间计入阈值而误杀，SSE 端点同样是 POST —— 都因不属安全方法而天然排除。
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 读请求处理超时：给 GET/HEAD/OPTIONS 处理器一个**客户端可见**的处理上界（Node 的
 * `server.requestTimeout` 只覆盖请求头/体的读取，不覆盖处理器执行，缺少这层时读处理器
 * 自身挂起没有任何上界）。
 *
 * 注意收益边界：rxjs `timeout` 只取消订阅，**不会**终止仍在执行的处理器与已开启的查询，
 * 连接池里的连接仍被占用——本拦截器不承诺「释放 DB 连接」。要保护连接池需另配 DB 侧上界
 * （如 Postgres `statement_timeout`）。
 *
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
  /**
   * 阈值在**构造期**解析一次：缺配置时在 DI 实例化（启动期）即失败，而不是拖到第一个请求
   * 才抛（那会经 `AllExceptionsFilter` 归成 500，等于「所有读请求全挂」）。仍不复制默认值。
   */
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    // getOrThrow 只保证键存在、不保证类型（ConfigService 可能是字符串），故显式 Number 归一
    const raw: unknown = this.config.getOrThrow('REQUEST_TIMEOUT_MS');
    this.timeoutMs = Number(raw);
    // 禁用状态要可观测：否则把 REQUEST_TIMEOUT_MS=0 随模板带进生产，只有读请求真挂住才发现
    if (!(this.timeoutMs > 0)) {
      this.logger.warn(
        `读请求超时已禁用：REQUEST_TIMEOUT_MS=${String(raw)}`,
        TimeoutInterceptor.name,
      );
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // SSE 显式放行（与 ApiResponseInterceptor 同一判据）：不能只依赖「SSE 端点是 POST」
    // 这一隐含前提——EventSource 只支持 GET，若流式端点改回 GET 或新增流式 GET，
    // 超时会静默掐断长回答
    const isSse = isSseHandler(context.getHandler());
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    if (isSse || !SAFE_METHODS.has(request.method ?? '')) {
      return next.handle();
    }
    // 用 `!(ms > 0)` 而非 `ms <= 0`：NaN（配置漂移）也归入禁用，避免 setTimeout(NaN) 按 0 处理
    if (!(this.timeoutMs > 0)) {
      return next.handle();
    }
    const ms = this.timeoutMs;
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
