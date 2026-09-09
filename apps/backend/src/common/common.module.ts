import {
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
import { RequestContextMiddleware } from './request-context.middleware.js';
import { ShutdownService } from './shutdown.service.js';

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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  providers: [
    AppLogger,
    ShutdownService,
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 全局限流守卫先于业务守卫执行（CommonModule 先于 AuthModule 导入）
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
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
