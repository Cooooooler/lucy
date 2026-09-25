import {
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_TITLE_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  KNOWLEDGE_KEYWORD_MAX_LENGTH,
  LOGIN_ACCOUNT_MAX_LENGTH,
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_CONTENT_MIN_LENGTH,
  MODEL_NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '@lucy/shared';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  CURSOR_MAX_LENGTH,
  CURSOR_PATTERN,
} from '../src/common/pagination/cursor.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../src/common/pagination/pagination.constants.js';
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

  it('校验边界同步写进 Swagger（Swagger 不解析 class-validator 装饰器）', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as {
      paths?: Record<
        string,
        Record<string, { parameters?: { name?: string; schema?: object }[] }>
      >;
      components?: {
        schemas?: Record<
          string,
          { properties?: Record<string, Record<string, unknown>> }
        >;
      };
    };

    const paramOf = (path: string, name: string) => {
      const params = doc.paths?.[path]?.get?.parameters ?? [];
      const found = params.find((p) => p.name === name);
      expect(found, `${path} 缺少 ${name} 查询参数`).toBeDefined();
      return found?.schema as Record<string, unknown>;
    };
    const propOf = (schema: string, name: string) => {
      const prop = doc.components?.schemas?.[schema]?.properties?.[name];
      expect(prop, `${schema}.${name} 缺少契约声明`).toBeDefined();
      return prop;
    };

    // 分页参数（CursorQueryDto / PageQueryDto）：默认值与上下界在文档可见
    for (const path of [
      '/knowledge',
      '/knowledge/{kbId}/documents',
      '/ai/conversations',
    ]) {
      expect(paramOf(path, 'limit')).toMatchObject({
        default: DEFAULT_PAGE_SIZE,
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
      });
      expect(paramOf(path, 'cursor')).toMatchObject({
        maxLength: CURSOR_MAX_LENGTH,
        pattern: CURSOR_PATTERN.source,
      });
    }
    // 会话列表已随 keyset 重构改用游标分页（page/pageSize 在该端点不存在），
    // 只剩用户列表仍走 PageQueryDto
    expect(paramOf('/users', 'pageSize')).toMatchObject({
      default: DEFAULT_PAGE_SIZE,
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
    });
    expect(paramOf('/users', 'page')).toMatchObject({ default: 1, minimum: 1 });

    // 各列表自己的过滤关键字：@MaxLength 只写在装饰器时文档是无边界字符串
    expect(paramOf('/knowledge', 'name')).toMatchObject({
      maxLength: KNOWLEDGE_KEYWORD_MAX_LENGTH,
    });
    expect(paramOf('/knowledge/{kbId}/documents', 'keyword')).toMatchObject({
      maxLength: KNOWLEDGE_KEYWORD_MAX_LENGTH,
    });

    // 请求体边界：只写 @MinLength/@MaxLength 时文档是空的，必须两处同步。
    // 期望值一律取自 @lucy/shared 的契约常量——否则改边界要动三处（装饰器/文档选项/测试），
    // 而且测试只能证明「等于某个字面量」而非「与前端共用的那份契约一致」
    expect(propOf('SendMessageDto', 'content')).toMatchObject({
      minLength: MESSAGE_CONTENT_MIN_LENGTH,
      maxLength: MESSAGE_CONTENT_MAX_LENGTH,
    });
    expect(propOf('SendMessageDto', 'model')).toMatchObject({
      maxLength: MODEL_NAME_MAX_LENGTH,
    });
    expect(propOf('CreateConversationDto', 'model')).toMatchObject({
      maxLength: MODEL_NAME_MAX_LENGTH,
    });
    expect(propOf('RenameConversationDto', 'title')).toMatchObject({
      minLength: CONVERSATION_TITLE_MIN_LENGTH,
      maxLength: CONVERSATION_TITLE_MAX_LENGTH,
    });
    // LoginDto：account 进等值查询、password 与注册侧同范围
    expect(propOf('LoginDto', 'account')).toMatchObject({
      minLength: 1,
      maxLength: LOGIN_ACCOUNT_MAX_LENGTH,
    });
    expect(propOf('LoginDto', 'password')).toMatchObject({
      minLength: 1,
      maxLength: PASSWORD_MAX_LENGTH,
    });
    expect(propOf('RegisterDto', 'nickname')).toMatchObject({
      minLength: NICKNAME_MIN_LENGTH,
      maxLength: NICKNAME_MAX_LENGTH,
    });
    expect(propOf('RegisterDto', 'username')).toMatchObject({
      minLength: USERNAME_MIN_LENGTH,
      maxLength: USERNAME_MAX_LENGTH,
      pattern: USERNAME_PATTERN.source,
    });
    // 密码只下发长度边界：复杂度正则带前瞻且需 u 标志，JSON Schema 的 pattern 无 flags、
    // Go RE2/Rust regex 编译前瞻会失败，规则改由 description 承载（schema 里无 pattern）
    expect(propOf('RegisterDto', 'password')).toMatchObject({
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    });
    expect(propOf('RegisterDto', 'password')?.pattern).toBeUndefined();
    // 邮箱上界与 users.email 列（varchar(255)）对齐，超长会在插入时报 22001（500）
    expect(propOf('RegisterDto', 'email')).toMatchObject({
      format: 'email',
      maxLength: EMAIL_MAX_LENGTH,
    });
  });
});
