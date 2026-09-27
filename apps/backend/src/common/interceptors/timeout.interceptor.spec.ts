import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, firstValueFrom, of } from 'rxjs';
import { SSE_METADATA } from '../sse-metadata.js';
import { TimeoutInterceptor } from './timeout.interceptor.js';

function contextFor(handler: object): ExecutionContext {
  return { getHandler: () => handler } as unknown as ExecutionContext;
}

const config = (ms?: number) =>
  new ConfigService(ms === undefined ? {} : { REQUEST_TIMEOUT_MS: ms });

const neverEnding = () => new Observable<never>(() => {});

describe('TimeoutInterceptor', () => {
  it('阈值内正常响应原样透传', async () => {
    const interceptor = new TimeoutInterceptor(config(1000));
    const next = { handle: () => of('ok') };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor({}), next)),
    ).resolves.toBe('ok');
  });

  it('处理器挂起超时：抛 RequestTimeoutException（408）', async () => {
    const interceptor = new TimeoutInterceptor(config(5));
    const next = { handle: neverEnding };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor({}), next)),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  it('SSE 处理器跳过超时（长时间流式不误杀）', async () => {
    const handler = {};
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const interceptor = new TimeoutInterceptor(config(5));
    const result = firstValueFrom(
      interceptor.intercept(contextFor(handler), { handle: neverEnding }),
    );
    // 若未跳过，5ms 后会 reject；跳过则应保持挂起
    const outcome = await Promise.race([
      result.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
    ]);
    expect(outcome).toBe('pending');
  });

  it('阈值为非有限值或 <=0 时禁用（视为未配置上限）', async () => {
    for (const value of [0, -1, Number.NaN]) {
      const interceptor = new TimeoutInterceptor(config(value));
      const next = { handle: () => of('ok') };
      await expect(
        firstValueFrom(interceptor.intercept(contextFor({}), next)),
      ).resolves.toBe('ok');
    }
  });
});
