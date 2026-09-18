import { ClassSerializerInterceptor } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { AppLogger } from './app-logger.service.js';
import { CommonModule } from './common.module.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor.js';
import { ShutdownService } from './shutdown.service.js';

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
    expect(providers).toContain(AppLogger);
    expect(providers).toContain(ShutdownService);
    expect(providers).toContainEqual({
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    });
    expect(providers).toContainEqual({
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    });
  });

  it('全局注册 ClassSerializerInterceptor，且排在信封拦截器之后（先序列化再包信封）', () => {
    const providers = (Reflect.getMetadata('providers', CommonModule) ??
      []) as Array<{ provide?: unknown; useClass?: unknown }>;
    const interceptorClasses = providers
      .filter((p) => p.provide === APP_INTERCEPTOR)
      .map((p) => p.useClass);
    // 顺序即拦截器链顺序：后注册者的响应 map 先执行，
    // 因此序列化必须排在 ApiResponseInterceptor 之后，否则它看到的已是 {code,message,data} 信封
    expect(interceptorClasses).toEqual([
      ApiResponseInterceptor,
      ClassSerializerInterceptor,
    ]);
  });

  it('导入 ClsModule（请求上下文）', () => {
    const imports = (Reflect.getMetadata('imports', CommonModule) ??
      []) as Array<{ module?: unknown }>;
    expect(imports.some((m) => m?.module === ClsModule)).toBe(true);
  });
});
