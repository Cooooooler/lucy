import {
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_TITLE_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  KNOWLEDGE_KEYWORD_MAX_LENGTH,
  LOGIN_ACCOUNT_MAX_LENGTH,
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_CONTENT_MIN_LENGTH,
  MODEL_API_KEY_MAX_LENGTH,
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

/** 本文件用到的文档形状（只声明 paths 一部分，免得每个用例各抄一份 cast） */
interface PartialOpenApiDoc {
  paths?: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, unknown> }> }
    >
  >;
}

/** 断言某端点的成功响应确实带 schema（历史上 get/update 的 200 是 content?: never） */
function hasSuccessSchema(
  doc: PartialOpenApiDoc,
  path: string,
  method: string,
  status: string,
): void {
  const content = doc.paths?.[path]?.[method]?.responses?.[status]?.content;
  expect(
    Object.keys(content ?? {}).length,
    `${method.toUpperCase()} ${path} 的 ${status} 缺少响应 schema`,
  ).toBeGreaterThan(0);
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
    // 用户契约现由允许式 DTO 承载（auth 注册/登录/me 与 users 各端点共用 UserListItemDto）；
    // 断言资料字段可见、passwordHash 不进契约。User 实体已不再作为任何响应类型出网，
    // 故不能再断言 `schemas.User`（该 schema 已不存在，可选链会恒为 undefined 造成空跑）。
    expect(
      doc.components?.schemas?.UserListItemDto?.properties?.username,
    ).toBeDefined();
    expect(
      doc.components?.schemas?.UserListItemDto?.properties?.passwordHash,
    ).toBeUndefined();
    // 反向断言：User 实体已从契约中消失。只做正向断言（UserListItemDto 存在）时，
    // 若有人把实体重新挂回 @ApiResponse({ type: User })，本用例仍会通过——
    // 反向断言才能钉住「实体不再作为响应契约」这一本次迁移的目标。
    expect(doc.components?.schemas?.User).toBeUndefined();
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

    hasSuccessSchema(doc, '/knowledge', 'get', '200');
    hasSuccessSchema(doc, '/knowledge', 'post', '201');
    hasSuccessSchema(doc, '/knowledge/{id}', 'get', '200');
    hasSuccessSchema(doc, '/knowledge/{id}', 'patch', '200');
    hasSuccessSchema(doc, '/knowledge/{kbId}/documents', 'get', '200');
    hasSuccessSchema(doc, '/knowledge/{kbId}/documents', 'post', '201');
    hasSuccessSchema(doc, '/knowledge/{kbId}/documents/{id}', 'get', '200');
  });

  it('AI 会话契约：列表项/创建/改名/详情共用同一份白名单，且各端点都带响应 schema', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as PartialOpenApiDoc & {
      components?: {
        schemas?: Record<
          string,
          { properties?: Record<string, unknown>; required?: string[] }
        >;
      };
    };

    // 允许式白名单：字段集固定（新增实体列不会自动进契约），且刻意不含 userId。
    // 此前只有 list 用 DTO、create/rename 用实体，同一资源出现两种形状，
    // 且实体上必填的 messages 在 create/rename 响应里永远不出现。
    const itemSchema = doc.components?.schemas?.ConversationItemDto;
    expect(itemSchema).toBeDefined();
    const keys = Object.keys(itemSchema?.properties ?? {}).sort();
    expect(keys).toEqual(
      ['createdAt', 'id', 'model', 'title', 'updatedAt'].sort(),
    );
    expect(itemSchema?.required?.sort()).toEqual(keys);

    hasSuccessSchema(doc, '/ai/conversations', 'get', '200');
    hasSuccessSchema(doc, '/ai/conversations', 'post', '201');
    hasSuccessSchema(doc, '/ai/conversations/{id}', 'patch', '200');

    // 详情端点：此前直接返回 Conversation 实体（带 userId、populate 的 messages），
    // 本次改为允许式 ConversationDetailDto = 列表项白名单 + 消息列表；补断言把
    // 「会话相关端点不再以实体出网」钉进 CI。
    hasSuccessSchema(doc, '/ai/conversations/{id}', 'get', '200');
    const detailSchema = doc.components?.schemas?.ConversationDetailDto;
    expect(detailSchema).toBeDefined();
    const detailKeys = Object.keys(detailSchema?.properties ?? {}).sort();
    expect(detailKeys).toEqual([...keys, 'messages'].sort());
    expect(detailSchema?.required?.sort()).toEqual(detailKeys);

    // 消息项同样是允许式白名单：不含内部关系对象 conversation，也不含其它实体字段
    const messageSchema = doc.components?.schemas?.MessageItemDto;
    expect(messageSchema).toBeDefined();
    expect(Object.keys(messageSchema?.properties ?? {}).sort()).toEqual(
      [
        'id',
        'conversationId',
        'role',
        'content',
        'thinking',
        'status',
        'truncated',
        'createdAt',
      ].sort(),
    );

    // 反向断言：Conversation / Message 实体已从契约中消失（会话端点全部走允许式 DTO）。
    // 只断言 DTO 存在不足以拦住「实体被重新挂回响应类型」的回归。
    expect(doc.components?.schemas?.Conversation).toBeUndefined();
    expect(doc.components?.schemas?.Message).toBeUndefined();
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
    // 模型供应商 API Key：ollama 可省略，但一旦提供即非空。@MinLength(1) 必须同步进文档，
    // 否则契约会把空串标为合法，与运行时的 400 相悖
    expect(propOf('CreateModelProviderDto', 'apiKey')).toMatchObject({
      minLength: 1,
      maxLength: MODEL_API_KEY_MAX_LENGTH,
    });
  });

  it('模型供应商契约：允许式白名单，且不含 API Key 明文/密文/尾号', async () => {
    await generateOpenApi();
    const doc = JSON.parse(readFileSync(OUT, 'utf8')) as PartialOpenApiDoc & {
      components?: {
        schemas?: Record<
          string,
          { properties?: Record<string, unknown>; required?: string[] }
        >;
      };
    };

    const item = doc.components?.schemas?.ModelProviderItemDto;
    expect(item).toBeDefined();
    const keys = Object.keys(item?.properties ?? {}).sort();
    expect(keys).toEqual(
      [
        'id',
        'ownerId',
        'name',
        'type',
        'vendor',
        'baseUrl',
        'protocol',
        'contextLength',
        'apiKeyMasked',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    // 反向断言：明文字段与实体上的密文/尾号列都不得进入契约
    expect(item?.properties?.apiKey).toBeUndefined();
    expect(item?.properties?.apiKeyEncrypted).toBeUndefined();
    expect(item?.properties?.apiKeyLast4).toBeUndefined();

    hasSuccessSchema(doc, '/model-providers', 'get', '200');
    hasSuccessSchema(doc, '/model-providers', 'post', '201');
    hasSuccessSchema(doc, '/model-providers/{id}', 'get', '200');
    hasSuccessSchema(doc, '/model-providers/{id}', 'patch', '200');
    hasSuccessSchema(
      doc,
      '/model-providers/{id}/test-connection',
      'post',
      '200',
    );
  });
});
