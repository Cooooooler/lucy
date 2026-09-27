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
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    if (!SAFE_METHODS.has(request.method ?? '')) {
      return next.handle();
    }
    // 阈值经 env schema 校验（整数，可为 <=0 表示禁用）；isFinite 分支仅作纯函数级防御
    // （单测会直接构造本类，绕过 schema）
    const ms = Number(this.config.get('REQUEST_TIMEOUT_MS', 120000));
    if (!Number.isFinite(ms) || ms <= 0) {
      return next.handle();
    }
    return next.handle().pipe(
      timeout(ms),
      catchError((err: unknown) =>
        err instanceof TimeoutError
          ? throwError(() => new RequestTimeoutException())
          : throwError(() => err),
      ),
    );
  }
}
