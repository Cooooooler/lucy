import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DocsModule } from '../src/docs/docs.module.js';

const OUT = fileURLToPath(new URL('../openapi.json', import.meta.url));

async function generateOpenApi(): Promise<void> {
  // 生成 OpenAPI 文档只需路由/DTO 的装饰器元数据，无需真实数据库连接；
  // 用假 DataSource 顶替 TypeOrmModule.forRootAsync 的真实连接，避免生成脚本依赖 Postgres
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(getDataSourceToken())
    .useValue({
      entityMetadatas: [],
      options: { type: 'postgres' },
      getRepository: () => ({}),
      getTreeRepository: () => ({}),
      getMongoRepository: () => ({}),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  const document = DocsModule.buildDocument(app);
  writeFileSync(OUT, JSON.stringify(document, null, 2));
}

describe('gen-openapi', () => {
  it('写出 openapi.json 且包含 auth 路由与核心 schema', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: {
        schemas?: Record<string, { properties?: Record<string, unknown> }>;
      };
    };
    expect(doc.paths?.['/auth/login']).toBeDefined();
    expect(doc.components?.schemas?.LoginDto).toBeDefined();
    expect(doc.components?.schemas?.LoginResultDto).toBeDefined();
    expect(
      Object.keys(
        doc.components?.schemas?.LoginResultDto?.properties ?? {},
      ).sort(),
    ).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(
      doc.components?.schemas?.User?.properties?.passwordHash,
    ).toBeUndefined();
  });
});
