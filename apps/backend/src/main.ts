import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { DocsModule } from './docs/docs.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    // 未配置 CORS_ORIGIN 时 origin:false 即仅同源（不返回 CORS 头），安全默认；跨源需显式白名单
    origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : false,
    credentials: true,
  });
  app.use(cookieParser());

  const requestLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      requestLogger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`,
      );
    });
    next();
  });

  DocsModule.setup(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
