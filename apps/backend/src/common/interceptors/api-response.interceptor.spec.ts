import { Logger, type ExecutionContext } from '@nestjs/common';
import 'reflect-metadata';
import { firstValueFrom, lastValueFrom, of } from 'rxjs';
import {
  SUCCESS_MESSAGE_KEY,
  type SuccessMessageResolver,
} from '../decorators/success-message.decorator.js';
import {
  ApiResponseInterceptor,
  SSE_METADATA,
  defaultSuccessMessage,
} from './api-response.interceptor.js';

function makeCtx(
  handler: (...args: unknown[]) => unknown,
  method = 'GET',
  body: unknown = undefined,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({ method, body }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();
  const next = { handle: () => of({ hello: 'world' }) } as never;

  it('未标注的 GET 裹为 {code:0, message:"ok", data}', async () => {
    const result: unknown = await firstValueFrom(
      interceptor.intercept(
        makeCtx(() => {}),
        next,
      ),
    );
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { hello: 'world' },
    });
  });

  it.each([
    ['POST', '操作成功'],
    ['PATCH', '更新成功'],
    ['PUT', '更新成功'],
    ['DELETE', '删除成功'],
  ])('未标注的 %s 按方法兜底为「%s」', async (method, message) => {
    const result = (await firstValueFrom(
      interceptor.intercept(
        makeCtx(() => {}, method),
        next,
      ),
    )) as { message: string };
    expect(result.message).toBe(message);
  });

  it('静态 @SuccessMessage 优先于方法兜底', async () => {
    const handler = () => {};
    Reflect.defineMetadata(SUCCESS_MESSAGE_KEY, '知识库已删除', handler);
    const result = (await firstValueFrom(
      interceptor.intercept(makeCtx(handler, 'DELETE'), next),
    )) as { message: string };
    expect(result.message).toBe('知识库已删除');
  });

  it('解析器返回值作为 message', async () => {
    const handler = () => {};
    const resolver: SuccessMessageResolver = (data) =>
      (data as { status: number }).status === 1 ? '用户已启用' : '用户已禁用';
    Reflect.defineMetadata(SUCCESS_MESSAGE_KEY, resolver, handler);
    const patched = { handle: () => of({ status: 0 }) } as never;
    const result = (await firstValueFrom(
      interceptor.intercept(makeCtx(handler, 'PATCH'), patched),
    )) as { message: string };
    expect(result.message).toBe('用户已禁用');
  });

  it('解析器抛错时记 warn 并回退方法级兜底，不把成功变 500', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      const handler = () => {};
      Reflect.defineMetadata(
        SUCCESS_MESSAGE_KEY,
        () => {
          throw new Error('resolver boom');
        },
        handler,
      );
      const result = (await firstValueFrom(
        interceptor.intercept(makeCtx(handler, 'DELETE'), next),
      )) as { message: string };
      expect(result.message).toBe('删除成功');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('resolver boom');
    } finally {
      warn.mockRestore();
    }
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

describe('defaultSuccessMessage', () => {
  it.each([
    ['POST', '操作成功'],
    ['PUT', '更新成功'],
    ['PATCH', '更新成功'],
    ['DELETE', '删除成功'],
    ['GET', 'ok'],
    ['HEAD', 'ok'],
  ])('%s → %s', (method, message) => {
    expect(defaultSuccessMessage(method)).toBe(message);
  });
});
