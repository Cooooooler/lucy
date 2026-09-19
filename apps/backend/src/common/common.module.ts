import {
  ClassSerializerInterceptor,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { AppLogger } from './app-logger.service.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor.js';
import { RATE_LIMIT_MESSAGE } from './messages.js';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { ShutdownService } from './shutdown.service.js';
import { validationExceptionFactory } from './validation-exception-factory.js';

@Module({
  imports: [
    // CLS 请求上下文：每个请求独立命名空间，存 userId 供日志自动注入。
    // 中间件模式（mount:true）自动为每个请求建上下文，无需守卫/拦截器手工 run。
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, _req) => {
          cls.set('userId', null);
          cls.set('reqId', randomUUID());
        },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      // 限流默认 message 是英文 `ThrottlerException: Too Many Requests`，
      // 前端只展示后端文案，所以这里就给出可读中文（与 429 兜底同源）。
      errorMessage: RATE_LIMIT_MESSAGE,
    }),
  ],
  providers: [
    AppLogger,
    ShutdownService,
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    // 序列化白名单全局生效（与 ApiResponseInterceptor 一致），而非按控制器逐个挂：
    // 实体上的 `@Exclude()` 只有经过它才生效，挂在单个控制器上时，同一实体从别的
    // 控制器返回就会把内部字段（关系对象、存储 key 等）一并泄出。
    // 注册顺序在 ApiResponseInterceptor 之后：响应阶段后注册者的 map 先跑，
    // 于是先按 @Exclude 序列化原始返回值，再被信封包裹。
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 全局限流守卫先于业务守卫执行（CommonModule 先于 AuthModule 导入）
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        // 校验失败的文案由后端统一转成可读中文（见 validation-exception-factory）
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
  exports: [AppLogger, ShutdownService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
