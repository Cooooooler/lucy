import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common.module.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor.js';

describe('CommonModule', () => {
  it('注册全局限流 ThrottlerModule 与 ThrottlerGuard（APP_GUARD）', () => {
    const imports = (Reflect.getMetadata('imports', CommonModule) ??
      []) as unknown[];
    expect(
      imports.some(
        (m) => (m as { module?: unknown })?.module === ThrottlerModule,
      ),
    ).toBe(true);
    const providers = (Reflect.getMetadata('providers', CommonModule) ??
      []) as unknown[];
    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    });
  });

  it('注册全局信封拦截器与统一异常过滤器', () => {
    const providers = (Reflect.getMetadata('providers', CommonModule) ??
      []) as unknown[];
    expect(providers).toContainEqual({
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    });
    expect(providers).toContainEqual({
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    });
  });
});
