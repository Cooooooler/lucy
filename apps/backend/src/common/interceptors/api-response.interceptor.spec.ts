import { firstValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor';

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();
  const ctx = {} as never;
  const next = { handle: () => of({ hello: 'world' }) } as never;

  it('将响应包裹为 {code:0, message:"ok", data}', async () => {
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { hello: 'world' },
    });
  });
});
