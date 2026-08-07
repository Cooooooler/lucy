import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

export class DocsModule {
  static setup(app: INestApplication): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const config = new DocumentBuilder()
      .setTitle('Lucy API')
      .setDescription(
        'Lucy 后端接口文档。所有响应统一包裹为 {code, message, data} 信封，下方 schema 仅描述 data 负载。',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    // apiReference 返回 `(FastifyRequest|Request, res)` 联合类型，非 Express RequestHandler；
    // Nest 的 INestApplication.use 签名接受 any，无需显式断言即可直接传入
    app.use('/docs', apiReference({ content: document }));
    app.getHttpAdapter().get('/docs-json', (_req: Request, res: Response) => {
      res.json(document);
    });
  }
}
