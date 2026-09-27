import { API_VERSION } from '@lucy/shared';
import {
  Logger as NestLogger,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { resolveCorsOrigin } from './common/cors.js';
import { DocsModule } from './docs/docs.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // 用 Pino Logger 替换 Nest 默认 Logger（已缓冲的启动日志随后刷新）
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.use(helmet());
  // 未配置 CORS_ORIGIN 时 origin:false 即仅同源（不返回 CORS 头），安全默认；跨源需显式白名单
  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
  });
  app.use(cookieParser());

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [VERSION_NEUTRAL, API_VERSION],
  });

  // Scalar 文档页需从 jsDelivr 加载脚本并执行内联脚本，helmet 默认 CSP 会拦截；
  // 仅对 /docs（及其子路径）覆盖为宽松 CSP，避免全局放宽。docs 仅非生产环境挂载。
  app.use('/docs', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:;",
    );
    next();
  });

  DocsModule.setup(app);
  // 优雅停机：SIGTERM/SIGINT 到达时结束 in-flight 请求并释放 DB/Redis 连接
  //（ShutdownService.onApplicationShutdown 先标记停机使健康检查返回 503）
  app.enableShutdownHooks();

  // 停机兜底：若 in-flight 请求/连接使 app.close() 长时间不返回，Nest 的 shutdown hook
  // 会一直等待，进程被 SIGTERM 后长期挂起（编排侧只能再补 SIGKILL，且日志里看不到卡在哪）。
  // 这里与 Nest 的信号监听并行注册一个定时器，超过宽限期即强制退出。
  // 宽限期取自**已校验的配置**（Joi 保证为正整数且带默认值）：默认值与边界只在
  // env-validation.schema 定义一次，此处既不重复兜底、也不给 get 传缺省值。
  const shutdownGraceMs = app
    .get(ConfigService)
    .getOrThrow<number>('SHUTDOWN_GRACE_MS');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      // unref：正常停机完成时该定时器不阻止进程退出
      setTimeout(() => {
        new NestLogger('Bootstrap').error(
          `优雅停机超过 ${shutdownGraceMs}ms，强制退出`,
        );
        process.exit(1);
      }, shutdownGraceMs).unref();
    });
  }
  process.on('unhandledRejection', (reason) => {
    new NestLogger('Bootstrap').error(
      'Unhandled rejection',
      reason instanceof Error ? reason.stack : String(reason),
    );
  });
  process.on('uncaughtException', (error) => {
    new NestLogger('Bootstrap').error('Uncaught exception', error.stack);
    process.exit(1);
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
