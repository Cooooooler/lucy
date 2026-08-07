process.env.DB_NAME = 'lucy_test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DocsModule } from '../src/docs/docs.module.js';

interface DocBody {
  info: { title: string };
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, { properties?: Record<string, unknown> }>;
  };
  paths?: Record<string, { get?: { security?: unknown[] } }>;
}

describe('Scalar docs (dev)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    DocsModule.setup(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/docs 返回 Scalar HTML', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Scalar API Reference');
  });

  it('/docs-json 暴露完整 OpenAPI 文档', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json');
    expect(res.status).toBe(200);
    const doc = res.body as DocBody;
    expect(doc.info.title).toBe('Lucy API');
    expect(doc.components?.securitySchemes?.bearer).toBeDefined();
    for (const path of [
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
    ]) {
      expect(doc.paths?.[path]).toBeDefined();
    }
    expect(
      JSON.stringify(doc.paths?.['/auth/me'].get?.security ?? []),
    ).toContain('bearer');
    expect(
      doc.components?.schemas?.RegisterDto?.properties?.username,
    ).toBeDefined();
    expect(
      Object.keys(
        doc.components?.schemas?.LoginResultDto?.properties ?? {},
      ).sort(),
    ).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(doc.components?.schemas?.User?.properties?.username).toBeDefined();
    expect(
      doc.components?.schemas?.User?.properties?.passwordHash,
    ).toBeUndefined();
  });
});

describe('Scalar docs (production no-op)', () => {
  let app: INestApplication<Server>;
  const savedEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    DocsModule.setup(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = savedEnv;
  });

  it('/docs 与 /docs-json 均 404', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
