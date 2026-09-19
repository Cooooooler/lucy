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

/**
 * 还原 NODE_ENV：直接 `process.env.NODE_ENV = saved` 在 saved 为 undefined 时会写入字符串
 * `'undefined'`（Node 对 process.env 赋值做字符串化），并不是恢复原状——同一 worker 里后续读
 * NODE_ENV 的代码会看到一个非空值（`?? 'development'` 这类兜底会被跳过）。
 */
function restoreNodeEnv(saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = saved;
  }
}

describe('Scalar docs (dev)', () => {
  let app: INestApplication<Server>;
  const savedEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // 显式钉成 test，而不是 `?? 'test'`：外部 shell 带着 NODE_ENV=production 时
    // DocsModule.setup 会直接 return，本用例会以「/docs 404」的形态失败（看似与改动无关）。
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    DocsModule.setup(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    restoreNodeEnv(savedEnv);
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
    ).toEqual(['accessToken', 'user']);
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
    restoreNodeEnv(savedEnv);
  });

  it('/docs 与 /docs-json 均 404', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
