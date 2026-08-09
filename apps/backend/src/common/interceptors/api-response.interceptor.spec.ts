import 'reflect-metadata';
import { firstValueFrom, lastValueFrom, of } from 'rxjs';
import {
  ApiResponseInterceptor,
  SSE_METADATA,
} from './api-response.interceptor.js';

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();
  const ctx = { getHandler: () => () => {} } as never;
  const next = { handle: () => of({ hello: 'world' }) } as never;

  it('将响应包裹为 {code:0, message:"ok", data}', async () => {
    const result: unknown = await firstValueFrom(
      interceptor.intercept(ctx, next),
    );
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { hello: 'world' },
    });
  });

  it('SSE 路由不包裹信封，原样透传', async () => {
    const handler = () => {};
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const ctx = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as Parameters<typeof interceptor.intercept>[0];
    const next = { handle: () => of('raw frame') };
    const result: unknown = await lastValueFrom(
      interceptor.intercept(ctx, next),
    );
    expect(result).toBe('raw frame');
  });
});
