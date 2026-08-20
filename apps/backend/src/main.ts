import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
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

  DocsModule.setup(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
