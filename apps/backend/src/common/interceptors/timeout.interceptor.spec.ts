import {
  ExecutionContext,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { AppLogger } from '../app-logger.service.js';
import { SSE_METADATA } from '../sse-metadata.js';
import { TimeoutInterceptor } from './timeout.interceptor.js';

function contextFor(method: string, handler: object = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url: '/ai/conversations?token=secret' }),
    }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

const config = (ms?: number) =>
  new ConfigService(ms === undefined ? {} : { REQUEST_TIMEOUT_MS: ms });

const neverEnding = () => new Observable<never>(() => {});

function make(ms?: number) {
  const warn = vi.fn();
  return {
    interceptor: new TimeoutInterceptor(config(ms), {
      warn,
    } as unknown as AppLogger),
    warn,
  };
}

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
    const { interceptor } = make(1000);
    const next = { handle: () => of('ok') };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor('GET'), next)),
    ).resolves.toBe('ok');
  });

  it('读请求处理器挂起超时：抛 408 并记 warn（路径不含 query string）', async () => {
    const { interceptor, warn } = make(5);
    const err = await firstValueFrom(
      interceptor.intercept(contextFor('GET'), { handle: neverEnding }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestTimeoutException);
    // 不带自定义 message：由全局过滤器按 408 归一（消息只在 messages.ts 定义）
    expect((err as RequestTimeoutException).message).toBe('Request Timeout');
    // 超时路径必须可观测：408 不进 AllExceptionsFilter 的日志（它只记 >=500）
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('GET /ai/conversations');
    expect(logged).not.toContain('token=secret');
  });

  it('写方法跳过超时（避免半途失败/重试重复写入，同时排除上传与 SSE）', async () => {
    const { interceptor } = make(5);
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
    const { interceptor } = make(5);
    expect(
      await settlesWithin(
        interceptor.intercept(contextFor('GET', handler), {
          handle: neverEnding,
        }),
        40,
      ),
    ).toBe('pending');
  });

  it('处理器自身抛出非超时错误：原样重抛，不吞成 408、不记超时 warn', async () => {
    const { interceptor, warn } = make(1000);
    const boom = new NotFoundException('会话不存在');
    const next = { handle: () => throwError(() => boom) };
    const err = await firstValueFrom(
      interceptor.intercept(contextFor('GET'), next),
    ).catch((e: unknown) => e);
    // 若误删 `instanceof TimeoutError` 判断，业务错误会被记成「请求处理超时」并回 408
    expect(err).toBe(boom);
    expect(warn).not.toHaveBeenCalled();
  });

  it('阈值为非有限值或 <=0 时禁用（视为未配置上限），并在构造期记 warn', async () => {
    for (const value of [0, -1, Number.NaN]) {
      const { interceptor, warn } = make(value);
      const next = { handle: () => of('ok') };
      await expect(
        firstValueFrom(interceptor.intercept(contextFor('GET'), next)),
      ).resolves.toBe('ok');
      // 禁用必须可观测，否则把 0 带进生产只有读请求真挂住才发现
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('已禁用');
    }
  });
});
