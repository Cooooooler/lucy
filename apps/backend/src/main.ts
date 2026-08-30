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
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
