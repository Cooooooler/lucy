import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, firstValueFrom, of } from 'rxjs';
import { SSE_METADATA } from '../sse-metadata.js';
import { TimeoutInterceptor } from './timeout.interceptor.js';

function contextFor(method: string, handler: object = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

const config = (ms?: number) =>
  new ConfigService(ms === undefined ? {} : { REQUEST_TIMEOUT_MS: ms });

const neverEnding = () => new Observable<never>(() => {});

/** 在 ms 窗口内既不 resolve 也不 reject → 'pending'，否则 'settled' */
async function settlesWithin(
  observable: Observable<unknown>,
  ms: number,
): Promise<'settled' | 'pending'> {
  return Promise.race([
    firstValueFrom(observable).then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), ms),
    ),
  ]);
}

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
    const err = await firstValueFrom(
      interceptor.intercept(contextFor('GET'), { handle: neverEnding }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestTimeoutException);
    // 不带自定义 message：由全局过滤器按 408 归一（消息只在 messages.ts 定义）
    expect((err as RequestTimeoutException).message).toBe('Request Timeout');
  });

  it('写方法跳过超时（避免半途失败/重试重复写入，同时排除上传与 SSE）', async () => {
    const interceptor = new TimeoutInterceptor(config(5));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        await settlesWithin(
          interceptor.intercept(contextFor(method), { handle: neverEnding }),
          40,
        ),
        `${method} 不应被套超时`,
      ).toBe('pending');
    }
  });

  it('SSE 处理器放行：即便方法是 GET 也不设超时', async () => {
    const handler = {};
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const interceptor = new TimeoutInterceptor(config(5));
    expect(
      await settlesWithin(
        interceptor.intercept(contextFor('GET', handler), {
          handle: neverEnding,
        }),
        40,
      ),
    ).toBe('pending');
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
