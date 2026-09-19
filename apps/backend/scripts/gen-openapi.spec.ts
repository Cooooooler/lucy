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
    ).toEqual(['accessToken', 'user']);
    expect(
      doc.components?.schemas?.User?.properties?.passwordHash,
    ).toBeUndefined();
  });

  it('知识库端点全部带 200/201 schema 且契约字段集一致', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as {
      paths?: Record<
        string,
        Record<
          string,
          { responses?: Record<string, { content?: Record<string, unknown> }> }
        >
      >;
      components?: {
        schemas?: Record<
          string,
          { properties?: Record<string, unknown>; required?: string[] }
        >;
      };
    };

    const itemSchema = doc.components?.schemas?.KnowledgeBaseItemDto;
    expect(itemSchema).toBeDefined();

    // 允许式白名单：字段集固定，新增实体字段不会自动进入契约
    const keys = Object.keys(itemSchema?.properties ?? {}).sort();
    expect(keys).toEqual(
      [
        'id',
        'ownerId',
        'visibility',
        'name',
        'description',
        'createdAt',
        'updatedAt',
        'likeCount',
        'isLiked',
      ].sort(),
    );
    // likeCount/isLiked 是必填：此前只有 get/list 附带，前端只能全声明成可选
    expect(itemSchema?.required?.sort()).toEqual(keys);

    /** 断言某端点的成功响应确实带 schema（历史上 get/update 的 200 是 content?: never） */
    const hasSuccessSchema = (path: string, method: string, status: string) => {
      const content = doc.paths?.[path]?.[method]?.responses?.[status]?.content;
      expect(
        Object.keys(content ?? {}).length,
        `${method.toUpperCase()} ${path} 的 ${status} 缺少响应 schema`,
      ).toBeGreaterThan(0);
    };
    hasSuccessSchema('/knowledge', 'get', '200');
    hasSuccessSchema('/knowledge', 'post', '201');
    hasSuccessSchema('/knowledge/{id}', 'get', '200');
    hasSuccessSchema('/knowledge/{id}', 'patch', '200');
    hasSuccessSchema('/knowledge/{kbId}/documents', 'get', '200');
    hasSuccessSchema('/knowledge/{kbId}/documents', 'post', '201');
    hasSuccessSchema('/knowledge/{kbId}/documents/{id}', 'get', '200');
  });

  it('文档详情/列表契约字段集固定（含/不含解析全文 content）', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as {
      components?: {
        schemas?: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    const detail = Object.keys(
      doc.components?.schemas?.KnowledgeDocumentDetailDto?.properties ?? {},
    ).sort();
    expect(detail).toEqual(
      [
        'id',
        'knowledgeBaseId',
        'fileId',
        'title',
        'content',
        'createdAt',
        'updatedAt',
      ].sort(),
    );

    // 列表项刻意不含 content（MB 级解析全文只随详情接口出网）
    const listItem = Object.keys(
      doc.components?.schemas?.KnowledgeDocumentListItemDto?.properties ?? {},
    ).sort();
    expect(listItem).toEqual(detail.filter((key) => key !== 'content'));
  });
});
