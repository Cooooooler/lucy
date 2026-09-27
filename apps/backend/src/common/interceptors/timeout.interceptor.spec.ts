import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, firstValueFrom, of } from 'rxjs';
import { TimeoutInterceptor } from './timeout.interceptor.js';

function contextFor(method: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
}

const config = (ms?: number) =>
  new ConfigService(ms === undefined ? {} : { REQUEST_TIMEOUT_MS: ms });

const neverEnding = () => new Observable<never>(() => {});

describe('TimeoutInterceptor', () => {
  it('读请求阈值内正常响应原样透传', async () => {
    const interceptor = new TimeoutInterceptor(config(1000));
    const next = { handle: () => of('ok') };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor('GET'), next)),
    ).resolves.toBe('ok');
  });

  it('读请求处理器挂起超时：抛 RequestTimeoutException（408，不带 message）', async () => {
    const interceptor = new TimeoutInterceptor(config(5));
    const next = { handle: neverEnding };
    const err = await firstValueFrom(
      interceptor.intercept(contextFor('GET'), next),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestTimeoutException);
    // 不带自定义 message：由全局过滤器按 408 归一（消息只在 messages.ts 定义）
    expect((err as RequestTimeoutException).message).toBe('Request Timeout');
  });

  it('写方法跳过超时（避免半途失败/重试重复写入，同时排除上传与 SSE）', async () => {
    const interceptor = new TimeoutInterceptor(config(5));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = firstValueFrom(
        interceptor.intercept(contextFor(method), { handle: neverEnding }),
      );
      const outcome = await Promise.race([
        result.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
      ]);
      expect(outcome, `${method} 不应被套超时`).toBe('pending');
    }
  });

  it('阈值为非有限值或 <=0 时禁用（视为未配置上限）', async () => {
    for (const value of [0, -1, Number.NaN]) {
      const interceptor = new TimeoutInterceptor(config(value));
      const next = { handle: () => of('ok') };
      await expect(
        firstValueFrom(interceptor.intercept(contextFor('GET'), next)),
      ).resolves.toBe('ok');
    }
  });
});
