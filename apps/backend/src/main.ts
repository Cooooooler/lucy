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
  // 配置统一经 ConfigService 读取（而不是直读 process.env）：取值/默认值与
  // envValidationSchema 的校验同源，启动期就拦下非法配置（`devops-use-config-module`）
  const config = app.get(ConfigService);
  app.use(helmet());
  // 未配置 CORS_ORIGIN 时 origin:false 即仅同源（不返回 CORS 头），安全默认；跨源需显式白名单
  app.enableCors({
    origin: resolveCorsOrigin(config.get<string>('CORS_ORIGIN')),
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

  DocsModule.setup(app, config.get<string>('NODE_ENV'));
  // 优雅停机：SIGTERM/SIGINT 触发 Nest 关闭生命周期 —— 先 `beforeApplicationShutdown`
  // （ShutdownService 置停机位使新请求被拒/健康检查 503，ChatStreamService 中止在途 SSE
  // 并等待其落库收敛），再 dispose 服务器、释放 DB/Redis 连接。整个过程的**兜底强退**与
  // 定时器撤销都在 ShutdownService 内，不在这里另起一份（否则成功停机也会被强退）。
  app.enableShutdownHooks();
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
  // 显式 Number：ConfigService 可能返回字符串（与 app.module 的 REDIS_PORT 同口径）；
  // 字符串端口会被 Node 当成 pipe path 而不是监听端口
  await app.listen(Number(config.get<number>('PORT', 3000)));
}
await bootstrap();
