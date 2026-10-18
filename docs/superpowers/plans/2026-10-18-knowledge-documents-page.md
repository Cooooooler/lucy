# 知识库详情页（文件表格）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 点击知识库卡片进入 `/_layout/knowledge/$kbId`，页头给出返回入口与知识库信息，主体是页码分页的文档（文件）表格：文件名 / 类型 / 大小 / 上传时间 / 查看解析文本 / 删除，并支持上传文档与关键字搜索。

**架构：** 后端把 `GET /v1/knowledge/{kbId}/documents` 由游标分页改为页码分页（`PageQueryDto` + `{list,total,page,pageSize}`，与 `/users` 同一套形状），并在文档列表/详情契约各补 `originalName/ext/mime/size` 四个文件元数据字段（查询 `innerJoin` `files` 表做列投影）。前端把 `knowledge.tsx` 拆成 layout + `index.tsx`（列表）+ `$kbId.tsx`（详情）；`CardShell` 增 `openLink` 覆盖热区（真锚点，角标/操作栏在后因此压住热区）；数据层由 `useInfiniteDocumentList` 换成 `useDocumentList`（`placeholderData` 保留上一页，翻页不闪骨架），表格用 `ProTable`。

**技术栈：** NestJS 11 + TypeORM（PostgreSQL）+ Swagger/OpenAPI（`pnpm typegen` 生成 `@lucy/shared` 契约）、React 19 + TanStack Router/Query + antd 6 + ProComponents、Vitest、Playwright。

**基线（开始前已确认全绿）：** 后端 68 文件 / 582 用例、前端 49 文件 / 378 用例、`scripts/gen-openapi.spec.ts` 6 用例。

**规格：** `docs/superpowers/specs/2026-10-18-knowledge-documents-page-design.md`

---

## 提交边界（先读这条）

本仓 pre-commit 钩子跑 `pnpm typegen` + `lint-staged` + `pnpm typecheck` + **全仓 `pnpm test`**，所以**每一个提交都必须是绿的**。而「后端契约改形状」与「前端消费方」通过生成的共享类型强耦合：后端单独提交时，前端 `listDocumentsApi` 的入参类型仍是旧游标形状，typecheck 必红。因此提交边界按**可编译的切片**划：

- **提交 1** = 任务 1–5：后端契约+分页改造 + 前端数据层同步（含后端 e2e 与 gen-openapi 断言）
- **提交 2** = 任务 6–7：卡片打开热区 + 路由目录化
- **提交 3** = 任务 8–10：详情页（表格/上传/抽屉）+ `formatBytes`
- **提交 4** = 任务 11：前端 e2e 冒烟补详情页路由

任务内部仍按 TDD 小步走（写测试 → 跑红 → 实现 → 跑绿），但**不逐个任务提交**。

---

## 文件结构

**后端（修改）**
- `apps/backend/src/knowledge/dto/document-list-query.dto.ts` —— 请求参数由 `CursorQueryDto` 改继承 `PageQueryDto`
- `apps/backend/src/knowledge/dto/knowledge-list-result.dto.ts` —— 文档列表结果改页码形状；列表项与详情各补 4 个文件元数据字段
- `apps/backend/src/knowledge/knowledge.mapper.ts` —— 列表项/详情映射文件元数据
- `apps/backend/src/knowledge/knowledge-document.service.ts` —— `listDocuments` 改 `skip/take + getManyAndCount`；`getDocument` 加载 `file` 关系；`addDocument` 回填新保存的 file
- `apps/backend/src/test/knowledge.fixtures.ts` —— 新增 `makeFile`，`makeDoc` 带 `file`，`makeDocQb` 换成页码版
- 测试：`dto/document-list-query.dto.spec.ts`、`knowledge-document.service.spec.ts`、`knowledge.controller.spec.ts`、`scripts/gen-openapi.spec.ts`、`test/knowledge.e2e-spec.ts`

**前端（修改 / 新建）**
- 修改 `apps/frontend/src/components/lib/utils.ts`（`formatBytes`）+ `apps/frontend/src/components/lib/utils.test.ts`
- 修改 `apps/frontend/src/api/knowledge.ts` + `apps/frontend/src/api/knowledge.test.ts`
- 修改 `apps/frontend/src/hooks/use-knowledge.ts` + `apps/frontend/src/hooks/use-knowledge.test.tsx`
- 修改 `apps/frontend/src/components/card-list/CardShell.tsx`，新建 `CardShell.test.tsx`
- 修改 `apps/frontend/src/components/knowledge/KnowledgeCard.tsx` + `KnowledgeCard.test.tsx`
- 新建 `apps/frontend/src/routes/_layout/knowledge.tsx`（纯 layout，替换现状文件）
- 新建 `apps/frontend/src/routes/_layout/knowledge/index.tsx`（现列表页内容），`knowledge.test.tsx` 移动为 `knowledge/index.test.tsx`
- 新建 `apps/frontend/src/components/knowledge/DocumentToolbar.tsx` + `DocumentToolbar.test.tsx`
- 新建 `apps/frontend/src/components/knowledge/DocumentTextDrawer.tsx` + `DocumentTextDrawer.test.tsx`
- 新建 `apps/frontend/src/routes/_layout/knowledge/$kbId.tsx` + `$kbId.test.tsx`
- 修改 `apps/frontend/e2e/smoke.spec.ts`

---

### 任务 1：后端请求 DTO 改页码分页

**文件：**
- 修改：`apps/backend/src/knowledge/dto/document-list-query.dto.ts`
- 测试：`apps/backend/src/knowledge/dto/document-list-query.dto.spec.ts`

- [ ] **步骤 1：改写测试（先红）**

把 `document-list-query.dto.spec.ts` 的基类说明与首个用例改成页码版（`cursor`/`limit` 的契约由 `CursorQueryDto` 的 spec 钉住，`page`/`pageSize` 由 `PageQueryDto` 的 spec 钉住，本文件只覆盖本 DTO 自己的 `keyword`）：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentListQueryDto } from './document-list-query.dto.js';

describe('DocumentListQueryDto', () => {
  it('空 body 合法（page/pageSize/keyword 均可选）', async () => {
    expect(
      await validate(plainToInstance(DocumentListQueryDto, {})),
    ).toHaveLength(0);
  });

  // page/pageSize 的契约由基类 PageQueryDto 的 spec 钉住，这里只覆盖本 DTO 自己的字段

  it('keyword 超过 100 字符校验失败（ILIKE 谓词走不了索引，超长输入是扫描放大器）', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      keyword: 'a'.repeat(101),
    });
    expect(await validate(dto)).not.toHaveLength(0);
    // 边界值本身合法
    expect(
      await validate(
        plainToInstance(DocumentListQueryDto, { keyword: 'a'.repeat(100) }),
      ),
    ).toHaveLength(0);
  });

  it('keyword 首尾空白被去掉', async () => {
    const dto = plainToInstance(DocumentListQueryDto, { keyword: '  正文  ' });
    expect(dto.keyword).toBe('正文');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('page/pageSize 经 @Type(() => Number) 从查询串转成数字', () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      page: '3',
      pageSize: '50',
    });
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(50);
  });
});
```

- [ ] **步骤 2：跑测试确认失败**

运行：`pnpm --filter @lucy/backend test src/knowledge/dto/document-list-query.dto.spec.ts`
预期：FAIL —— `page`/`pageSize` 未定义（DTO 仍继承 `CursorQueryDto`）。

- [ ] **步骤 3：改 DTO**

`apps/backend/src/knowledge/dto/document-list-query.dto.ts` 全文：

```ts
import { KNOWLEDGE_KEYWORD_MAX_LENGTH } from '@lucy/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination/dto/page-query.dto.js';

/**
 * 文档列表的请求参数：**页码分页**（与用户管理列表同一套 `PageQueryDto` 边界），
 * 这里只声明本列表自己的过滤字段。
 *
 * 为什么不是游标分页：本列表的消费方是详情页的表格，要页码、总条数与跳页，
 * 游标（nextCursor）表达不了这些。知识库列表仍是游标分页（卡片 + 虚拟网格无限滚动）。
 */
export class DocumentListQueryDto extends PageQueryDto {
  // 长度上限与 cursor 的边界策略保持一致：该关键字会拼成 `title ILIKE '%…%' OR content ILIKE '%…%'`，
  // 谓词无法走索引，超长输入是廉价的全表扫描放大器；顺带去掉首尾空白
  @ApiPropertyOptional({
    description: `匹配标题/内容的关键字（最多 ${KNOWLEDGE_KEYWORD_MAX_LENGTH} 字符）`,
    maxLength: KNOWLEDGE_KEYWORD_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(KNOWLEDGE_KEYWORD_MAX_LENGTH)
  keyword?: string;
}
```

- [ ] **步骤 4：跑测试确认通过**

运行：`pnpm --filter @lucy/backend test src/knowledge/dto/document-list-query.dto.spec.ts`
预期：PASS（4 个用例）。

---

### 任务 2：后端契约补文件元数据 + 列表结果改页码形状

**文件：**
- 修改：`apps/backend/src/knowledge/dto/knowledge-list-result.dto.ts`
- 修改：`apps/backend/src/knowledge/knowledge.mapper.ts`
- 修改：`apps/backend/src/test/knowledge.fixtures.ts`

- [ ] **步骤 1：结果 DTO 改形状**

`knowledge-list-result.dto.ts` 里与文档相关的三个类替换为（`KnowledgeBaseItemDto` / `KnowledgeListResultDto` 不动）：

```ts
import type { CursorPageResult, PageResult } from '@lucy/shared';

/** 文档列表响应：页码分页（形状由共享 `PageResult` 编译期约束，与用户列表一致） */
export class DocumentListResultDto implements PageResult<KnowledgeDocumentListItemDto> {
  @ApiProperty({
    description: '文档列表（不含解析全文 content）',
    type: () => [KnowledgeDocumentListItemDto],
  })
  list: KnowledgeDocumentListItemDto[];

  @ApiProperty({ description: '总条数', example: 0 })
  total: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize: number;
}

/**
 * 文档列表项：同样是一份显式允许式白名单。
 *
 * 关键差异是刻意**不含 `content`**：它是解析出的纯文本，可达 MB 级，列表页只用文件元信息；
 * `content` 只由 `GET /knowledge/:kbId/documents/:id` 详情接口返回。
 * 列表查询同时做了列投影（见 `KnowledgeDocumentService.listDocuments`），避免把整列读出来。
 *
 * `originalName`/`ext`/`mime`/`size` 来自 `files` 表（查询 `innerJoin` 后投影），
 * 与详情契约的字段集**必须保持一致**（详情 = 列表 + content，由 gen-openapi.spec.ts 钉住）。
 */
export class KnowledgeDocumentListItemDto {
  @ApiProperty({ description: '文档 ID' })
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  fileId: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiProperty({ description: '原始文件名' })
  originalName: string;

  @ApiProperty({ description: '扩展名（含点，如 .pdf）' })
  ext: string;

  @ApiProperty({ description: 'MIME 类型' })
  mime: string;

  @ApiProperty({ description: '文件大小（字节）' })
  size: number;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/** 文档详情/上传响应（列表项 + 解析全文 `content`） */
export class KnowledgeDocumentDetailDto {
  @ApiProperty({ description: '文档 ID' })
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  fileId: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiProperty({ description: '原始文件名' })
  originalName: string;

  @ApiProperty({ description: '扩展名（含点，如 .pdf）' })
  ext: string;

  @ApiProperty({ description: 'MIME 类型' })
  mime: string;

  @ApiProperty({ description: '文件大小（字节）' })
  size: number;

  @ApiProperty({
    description: '解析出的纯文本',
    type: String,
    nullable: true,
  })
  content: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}
```

同时把文件顶部原来的 `import type { CursorPageResult } from '@lucy/shared';` 改成 `import type { CursorPageResult, PageResult } from '@lucy/shared';`（`CursorPageResult` 仍被 `KnowledgeListResultDto` 使用）。

- [ ] **步骤 2：mapper 补文件元数据**

`knowledge.mapper.ts` 加一处私有映射并改两个函数（顶部补 `import type { BackendFileEntity } from './entities/backend-file.entity.js';`）：

```ts
/** 文档契约里的文件元信息（来自 `files` 表） */
type DocumentFileMeta = {
  originalName: string;
  ext: string;
  mime: string;
  size: number;
};

/**
 * 从已加载的 `file` 关系取文件元信息。
 *
 * ⚠️ 调用方必须保证 `file` 关系已加载，否则这四个字段会静默变成空值/0：
 * - 列表：`listDocuments` 用 `innerJoin('d.file', 'f')` + `addSelect`（`file_id` 是 NOT NULL 外键，内连接不会丢行）
 * - 详情：`getDocument` 用 `relations: { file: true }`
 * - 上传：`addDocument` 把刚保存的 file 实体回填到返回对象上
 * 三处都有 service 用例钉住，缺失时测试会红而不是悄悄返回空文件名。
 */
function fileMetaOf(doc: KnowledgeDocument): DocumentFileMeta {
  return {
    originalName: doc.file?.originalName ?? '',
    ext: doc.file?.ext ?? '',
    mime: doc.file?.mime ?? '',
    size: doc.file?.size ?? 0,
  };
}

export function toDocumentListItem(
  doc: KnowledgeDocument,
): KnowledgeDocumentListItemDto {
  const { id, knowledgeBaseId, fileId, title, createdAt, updatedAt } = doc;
  return {
    id,
    knowledgeBaseId,
    fileId,
    title,
    ...fileMetaOf(doc),
    createdAt,
    updatedAt,
  };
}

export function toDocumentDetail(
  doc: KnowledgeDocument,
): KnowledgeDocumentDetailDto {
  const { id, knowledgeBaseId, fileId, title, content, createdAt, updatedAt } =
    doc;
  return {
    id,
    knowledgeBaseId,
    fileId,
    title,
    ...fileMetaOf(doc),
    content,
    createdAt,
    updatedAt,
  };
}
```

`BackendFileEntity` 仅为文档注释引用，实际不参与类型标注——若 lint 判定未使用，删掉该 import（`doc.file` 的类型来自 `KnowledgeDocument`）。

- [ ] **步骤 3：夹具加 `makeFile`、`makeDoc` 带 file、`makeDocQb` 换页码版**

`apps/backend/src/test/knowledge.fixtures.ts`：

1. 顶部补 `import type { BackendFileEntity } from '../knowledge/entities/backend-file.entity.js';`（只在类型位置使用，必须 `import type`）
2. 在 `makeDoc` 之前加：

```ts
/** 文件元数据实体夹具（文档列表/详情契约的 `originalName`/`ext`/`mime`/`size` 来源） */
export const makeFile = (
  over: Partial<BackendFileEntity> = {},
): BackendFileEntity => ({
  id: 'f1',
  ownerId: 'u1',
  originalName: 'a.pdf',
  ext: '.pdf',
  mime: 'application/pdf',
  size: 1024,
  key: 'kb-e2e/f1.pdf',
  hash: 'a'.repeat(64),
  storage: 'local',
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...over,
});
```

3. `makeDoc` 默认带上 file 关系：把返回值里的 `fileId: 'f1',` 之后加一行 `file: makeFile(),`
4. `DocQb` 类型与 `makeDocQb` 换成页码版：

```ts
/** 文档列表用的 QueryBuilder stub 形状（页码分页：skip/take + getManyAndCount） */
type DocQb = {
  select: Mock;
  addSelect: Mock;
  innerJoin: Mock;
  where: Mock;
  andWhere: Mock;
  orderBy: Mock;
  addOrderBy: Mock;
  skip: Mock;
  take: Mock;
  getManyAndCount: Mock;
};

/** 可链式 QueryBuilder mock：供文档 list 用（docRepo） */
export const makeDocQb = (): DocQb => {
  const qb = {
    select: vi.fn(),
    addSelect: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    skip: vi.fn(),
    take: vi.fn(),
    getManyAndCount: vi.fn(),
  };
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.innerJoin.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.skip.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);
  qb.getManyAndCount.mockResolvedValue([[makeDoc()], 1]);
  return qb;
};
```

`makeKbQb` / `aliasStub` / `makeLikeQb` / `sqlOf` 全部保留（知识库列表仍走 `KeysetPaginator`）。

- [ ] **步骤 4：跑后端编译与既有测试（此时预期红，属正常）**

运行：`pnpm --filter @lucy/backend typecheck`
预期：FAIL —— `knowledge-document.service.ts` 尚未按新形状返回；`knowledge-document.service.spec.ts` 里对旧字段集的断言也还不匹配。任务 3 修好。

---

### 任务 3：后端 `listDocuments` 改页码分页并 join files

**文件：**
- 修改：`apps/backend/src/knowledge/knowledge-document.service.ts`
- 测试：`apps/backend/src/knowledge/knowledge-document.service.spec.ts`、`apps/backend/src/knowledge/knowledge.controller.spec.ts`

- [ ] **步骤 1：改写 service 用例（先红）**

`knowledge-document.service.spec.ts`：把 import 里的 `decodeCursor, encodeCursor` 去掉（游标只属于知识库列表了），`MAX_PAGE_SIZE` 从 `../common/pagination/pagination.constants.js` 引入；再把这 4 个用例替换成页码版：

```ts
  it('listDocuments 公开库非属主可读，按页码分页返回 total', async () => {
    kbRepo.findOne.mockResolvedValue(
      makeKb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    const qb = makeDocQb();
    qb.getManyAndCount.mockResolvedValue([[makeDoc()], 42]);
    docRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await docService.listDocuments('u2', 'kb1', {
      page: 3,
      pageSize: 5,
    });

    expect(qb.where).toHaveBeenCalledWith('d.knowledgeBaseId = :kbId', {
      kbId: 'kb1',
    });
    // OFFSET = (page - 1) * pageSize
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(qb.orderBy).toHaveBeenCalledWith('d.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('d.id', 'DESC');
    expect(result).toMatchObject({ total: 42, page: 3, pageSize: 5 });
    expect(result.list).toEqual([
      expect.objectContaining({ id: DOC_ID, title: 'a' }),
    ]);
  });

  it('listDocuments 归一化非法页码/每页条数（pageSize 越界不会变成全量扫描）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);

    await docService.listDocuments('u1', 'kb1', { page: 0, pageSize: 1e6 });

    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
  });

  it('listDocuments 做列投影：content 不进 SELECT，join files 取文件元数据', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await docService.listDocuments('u1', 'kb1', {});

    // file_id 是 NOT NULL 外键（onDelete CASCADE），内连接不会丢行；文件元数据随列表一起取
    expect(qb.innerJoin).toHaveBeenCalledWith('d.file', 'f');
    // 显式列投影：content（text，可达 MB 级）不进 SELECT
    const selected = qb.select.mock.calls[0][0] as string[];
    expect(selected).toEqual([
      'd.id',
      'd.knowledgeBaseId',
      'd.fileId',
      'd.title',
      'd.createdAt',
      'd.updatedAt',
    ]);
    expect(selected).not.toContain('d.content');
    expect(qb.addSelect).toHaveBeenCalledWith([
      'f.originalName',
      'f.ext',
      'f.mime',
      'f.size',
    ]);
    // 响应同样不含 content，文件元数据齐全
    expect(result.list[0]).not.toHaveProperty('content');
    expect(
      Object.keys(result.list[0]).sort((a, b) => a.localeCompare(b)),
    ).toEqual([
      'createdAt',
      'ext',
      'fileId',
      'id',
      'knowledgeBaseId',
      'mime',
      'originalName',
      'size',
      'title',
      'updatedAt',
    ]);
    expect(result.list[0]).toMatchObject({
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: 1024,
    });
  });

  it('listDocuments 带 keyword 追加 ILIKE 过滤（转义通配符）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    await docService.listDocuments('u1', 'kb1', { keyword: 'x' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.title ILIKE :kw OR d.content ILIKE :kw)',
      { kw: '%x%' },
    );
  });
```

再补两条与新读路径相关的用例（`getDocument` 加载 file、`addDocument` 回填 file）：

```ts
  it('getDocument 加载 file 关系：详情契约带文件元数据（否则文件名会是空串）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.findOne.mockResolvedValue(makeDoc({ content: '正文' }));

    const result = await docService.getDocument('u1', 'kb1', DOC_ID);

    expect(docRepo.findOne).toHaveBeenCalledWith({
      where: { id: DOC_ID, knowledgeBaseId: 'kb1' },
      relations: { file: true },
    });
    expect(result).toMatchObject({
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: 1024,
      content: '正文',
    });
  });
```

（`addDocument` 的回填在任务 3 步骤 3 一并实现，用例放在现有「addDocument 成功」用例的断言里追加一行 `expect(result.originalName).toBe('a.pdf');`——上传响应对齐详情契约。）

- [ ] **步骤 2：跑测试确认失败**

运行：`pnpm --filter @lucy/backend test src/knowledge/knowledge-document.service.spec.ts`
预期：FAIL —— `qb.skip` 不是函数（stub 已换页码版，实现仍走 `KeysetPaginator`）。

- [ ] **步骤 3：改 service 实现**

`knowledge-document.service.ts`：
1. import 改为 `import { escapeLikePattern } from '../common/like-pattern.js';` 之后补 `import { resolvePageNumber, resolvePageSize } from '../common/pagination/page-params.js';`，并删掉 `KeysetPaginator` 的 import 与构造注入（该服务不再需要它——分页改由 `skip/take` 表达）；`KeysetPaginator` 的 provider 仍由 `PaginationModule` 提供给 `KnowledgeService`，模块无需改。
2. `listDocuments` 方法体换成：

```ts
  /**
   * 分页查询某知识库下的文档（页码分页，与用户管理列表同一套边界策略）。
   * 按**不可变**的 (created_at, id) 降序排序，`skip/take` 由归一化后的 page/pageSize 派生。
   * 可按 `keyword` 模糊匹配标题或解析出的纯文本。
   *
   * 列表**不返回 `content`**（解析出的全文，可达 MB 级）：查询做显式列投影，
   * 返回前经 `toDocumentListItem` 收敛成列表项契约，`content` 只由详情接口给出。
   * 文件元数据（文件名/扩展名/MIME/大小）随 `innerJoin` `files` 一起取，
   * 避免前端表格每行再发一次请求（N+1）。
   * @throws NotFoundException / ForbiddenException
   */
  async listDocuments(
    userId: string,
    kbId: string,
    query: DocumentListQueryDto,
  ): Promise<DocumentListResultDto> {
    await resolveReadableKb(this.kbRepo, kbId, userId);

    // 入参归一化：DTO 的 @Min/@Max 只作用于 HTTP 路径，越界 pageSize 会变成一次全量 LIMIT 扫描
    const page = resolvePageNumber(query.page);
    const pageSize = resolvePageSize(query.pageSize);

    const qb = this.docRepo
      .createQueryBuilder('d')
      // file_id 是 NOT NULL 外键（onDelete CASCADE），内连接不会丢行
      .innerJoin('d.file', 'f')
      // 显式列投影：直接把 content 挡在 SELECT 之外（keyword 对 content 的 ILIKE 仍在 WHERE 里，
      // 那是过滤、不读取整列回传），避免每页把 20 篇全文一次拉回
      .select([
        'd.id',
        'd.knowledgeBaseId',
        'd.fileId',
        'd.title',
        'd.createdAt',
        'd.updatedAt',
      ])
      .addSelect(['f.originalName', 'f.ext', 'f.mime', 'f.size'])
      .where('d.knowledgeBaseId = :kbId', { kbId });
    if (query.keyword) {
      qb.andWhere('(d.title ILIKE :kw OR d.content ILIKE :kw)', {
        kw: `%${escapeLikePattern(query.keyword)}%`,
      });
    }
    // 排序键不可变：OFFSET 分页下用可变键会让被更新的行越过窗口、在后续页被漏掉。
    // `IDX_knowledge_documents_kb_created_id` 提供 (knowledge_base_id, created_at DESC, id DESC)
    // 的有序扫描，OFFSET 同样走它，无需新增迁移。
    qb.orderBy('d.created_at', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return {
      list: rows.map(toDocumentListItem),
      total,
      page,
      pageSize,
    };
  }
```

3. `getDocument` 加载 file 关系：`this.docRepo.findOne({ where: { id, knowledgeBaseId: kbId }, relations: { file: true } })`。
4. `addDocument` 的事务返回值回填 file：把 `return docRepo.save({ ... })` 改成

```ts
        const saved = await docRepo.save({
          knowledgeBaseId: kbId,
          fileId: fileEntity.id,
          title,
          content,
        });
        // 详情契约含文件元数据：把刚保存的 file 实体挂回返回对象（避免再查一次）
        return { ...saved, file: fileEntity };
```

- [ ] **步骤 4：跑测试确认通过**

另外把 `buildService` 的 `imports: [PaginationModule]` 与那段「KeysetPaginator 刻意不在这里 provide」的 JSDoc 一并删掉（该服务不再依赖 `KeysetPaginator`），相应删掉 import。

运行：`pnpm --filter @lucy/backend test src/knowledge`
预期：PASS（knowledge 模块全部 spec）。

- [ ] **步骤 5：controller spec 的 query 形状**

`knowledge.controller.spec.ts` 的 `listDocuments 转发 userId、kbId、query` 里，`const query = { keyword: 'x' };` 改成 `const query = { keyword: 'x', page: 1, pageSize: 20 };`（其余断言不变，controller 本身无需改动）。

运行：`pnpm --filter @lucy/backend test src/knowledge/knowledge.controller.spec.ts`
预期：PASS。

---

### 任务 4：后端 gen-openapi 与 e2e 断言更新

**文件：**
- 修改：`apps/backend/scripts/gen-openapi.spec.ts`
- 修改：`apps/backend/test/knowledge.e2e-spec.ts`

- [ ] **步骤 1：改 gen-openapi 的两个钉住用例**

`scripts/gen-openapi.spec.ts`：

1. 「文档详情/列表契约字段集固定」用例里，`detail` 的期望数组补 4 个字段（列表项那句 `detail.filter((key) => key !== 'content')` 不用改，自动跟随）：

```ts
    const detail = Object.keys(
      doc.components?.schemas?.KnowledgeDocumentDetailDto?.properties ?? {},
    ).sort();
    expect(detail).toEqual(
      [
        'id',
        'knowledgeBaseId',
        'fileId',
        'title',
        'originalName',
        'ext',
        'mime',
        'size',
        'content',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
```

2. 「校验边界同步写进 Swagger」用例里，游标分组只剩两个端点，页码分组加上文档列表：

```ts
    // 分页参数（CursorQueryDto / PageQueryDto）：默认值与上下界在文档可见
    for (const path of ['/knowledge', '/ai/conversations']) {
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
    // 走 PageQueryDto 的两个列表：用户管理，以及文档列表（表格要页码与总数）
    for (const path of ['/users', '/knowledge/{kbId}/documents']) {
      expect(paramOf(path, 'pageSize')).toMatchObject({
        default: DEFAULT_PAGE_SIZE,
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
      });
      expect(paramOf(path, 'page')).toMatchObject({ default: 1, minimum: 1 });
    }
```

- [ ] **步骤 2：跑 gen-openapi**

运行：`pnpm --filter @lucy/backend gen:openapi`
预期：PASS（6 用例）。

- [ ] **步骤 3：e2e 改页码 + 补元数据断言（先红）**

`apps/backend/test/knowledge.e2e-spec.ts`：

1. `sweepDocuments` 换成页码版并返回 `{ ids, total }`：

```ts
  /**
   * 用页码逐页翻完某个知识库的**文档**列表，收集全部 id 与 total。
   * 走真实 HTTP，顺带断言列表项不带解析全文、带文件元数据（列投影 + 分页 + join 一起验）。
   */
  async function sweepDocuments(
    pageSize: number,
  ): Promise<{ ids: string[]; total: number }> {
    const ids: string[] = [];
    let total = 0;
    for (let page = 1; page <= 1000; page++) {
      const res = await request(server)
        .get(`/v1/knowledge/${docsPageKbId}/documents`)
        .query({ page: String(page), pageSize: String(pageSize) })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as ApiBody<{
        list: Record<string, unknown>[];
        total: number;
        page: number;
        pageSize: number;
      }>;
      // 响应回显本次分页参数：契约里的 page/pageSize 必须与请求一致
      expect(body.data.page).toBe(page);
      expect(body.data.pageSize).toBe(pageSize);
      total = body.data.total;
      for (const item of body.data.list) {
        expect(item).not.toHaveProperty('content');
        expect(item).not.toHaveProperty('file');
        expect(typeof item.originalName).toBe('string');
        expect(typeof item.size).toBe('number');
        ids.push(item.id as string);
      }
      if (body.data.list.length < pageSize) return { ids, total };
    }
    throw new Error('文档分页未收敛：页码翻到 1000 页仍未取完');
  }
```

2. 「文档列表 keyset 分页」用例改成页码版（同样验证同毫秒按 id 决胜、不重不漏）：

```ts
  it('文档列表页码分页：同毫秒按 id 决胜、逐页不重不漏（真实 SQL + 列投影 + join files）', async () => {
    const expected = await expectedDocumentOrder();
    expect(expected).toHaveLength(10);

    // pageSize 取 1/2/3：1 与 2 会落在同毫秒并列组内部（排序必须用 id 决胜），3 覆盖跨页裁剪
    for (const pageSize of [1, 2, 3]) {
      const { ids, total } = await sweepDocuments(pageSize);
      expect(ids, `pageSize=${pageSize}`).toEqual(expected);
      // 无重复：翻页没有把同一行返回两次
      expect(new Set(ids).size).toBe(ids.length);
      expect(total).toBe(expected.length);
    }
  });

  it('文档列表页码越界：返回空 list，total 不变', async () => {
    const res = await request(server)
      .get(`/v1/knowledge/${docsPageKbId}/documents`)
      .query({ page: '99', pageSize: '3' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as ApiBody<{ list: unknown[]; total: number }>;
    expect(body.data.list).toEqual([]);
    expect(body.data.total).toBe(10);
  });
```

3. 「文档列表做列投影」用例：断言字段集与真实文件元数据：

```ts
    expect(item.title).toBe('文档标题');
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('file');
    expect(item.originalName).toBe('a.txt');
    expect(item.ext).toBe('.txt');
    expect(item.mime).toBe('text/plain');
    expect(item.size).toBe(12);
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'knowledgeBaseId',
        'fileId',
        'title',
        'originalName',
        'ext',
        'mime',
        'size',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
```

4. 第二个 describe 的「documents 列表 / 详情响应剔除已填充的 knowledgeBase 与 file」用例：`Object.keys(docItem).sort()` 的期望数组同样补上那 4 个字段（`not.toHaveProperty('file')` 断言保留——文件元数据是**平铺字段**，不是关系对象）。

- [ ] **步骤 4：起依赖并跑 e2e**

运行：`docker compose up -d`（Postgres + Redis；若本机已有则跳过）
运行：`pnpm --filter @lucy/backend test:e2e`
预期：PASS。若报 `originalName` 为空 → 说明 `innerJoin + addSelect` 没把关系水合到实体上，改用 `leftJoinAndSelect('d.file', 'f')` 并同步列投影断言（见风险一节）。

---

### 任务 5：前端数据层由游标改页码（提交 1 的收尾）

**文件：**
- 修改：`apps/frontend/src/api/knowledge.ts`、`apps/frontend/src/api/knowledge.test.ts`
- 修改：`apps/frontend/src/hooks/use-knowledge.ts`、`apps/frontend/src/hooks/use-knowledge.test.tsx`

- [ ] **步骤 1：重新生成共享契约类型**

运行：`pnpm typegen`
预期：无报错；`packages/shared/src/generated/openapi.ts` 里 `KnowledgeDocumentListItemDto` 出现 4 个新字段、`DocumentListQuery` 变为 `page/pageSize/keyword`。

- [ ] **步骤 2：改 api 与测试（先红）**

`api/knowledge.test.ts`：`makeDocument` / `makeDocumentListItem` 两个工厂补 4 个字段（`originalName: 'intro.md'`, `ext: '.md'`, `mime: 'text/markdown'`, `size: 1024`），并把 `listDocumentsApi` 用例换成：

```ts
  it('listDocumentsApi 携带页码/每页条数/关键字参数', async () => {
    const data = {
      list: [makeDocumentListItem()],
      total: 1,
      page: 2,
      pageSize: 20,
    };
    fetchMock.mockResolvedValueOnce(okEnvelope(data));
    const result = await listDocumentsApi('kb1', {
      page: 2,
      pageSize: 20,
      keyword: 'hello',
    });
    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/knowledge/kb1/documents?page=2&pageSize=20&keyword=hello',
      expect.objectContaining({ method: 'GET' }),
    );
  });
```

`api/knowledge.ts`：`listDocumentsApi` 的返回类型换成 `PageResult<KnowledgeDocumentListItem>`（`PageResult` 从 `@lucy/shared` 引入，`CursorPageResult` 仍被 `listKnowledgeBasesApi` 使用，保留）：

```ts
// 列表返回的是列表项（不含解析全文 content），详情接口才返回 KnowledgeDocument；
// 分页为页码式（page/pageSize/total），与用户管理列表同一套共享形状
export function listDocumentsApi(kbId: string, query: DocumentListQuery = {}) {
  return http
    .get<PageResult<KnowledgeDocumentListItem>>(
      `knowledge/${kbId}/documents`,
      query,
    )
    .json();
}
```

运行：`pnpm --filter @lucy/frontend test src/api/knowledge.test.ts`
预期：先 FAIL（旧实现仍声明游标返回），改完 PASS。

- [ ] **步骤 3：改 hooks 与测试**

`hooks/use-knowledge.ts`：
- 删掉 `useInfiniteDocumentList`，换成 `useDocumentList`；
- `DocumentListFilter` 保留 `{ keyword?: string }`（详情页的筛选状态用它）；
- `documentList` key 的入参类型由 `DocumentListQueryShape` 改为 `DocumentListQuery`（生成的类型已含 `page/pageSize/keyword`），并删掉 `DocumentListQueryShape` 类型别名；
- import 里去掉不再需要的 `useCursorList`（知识库列表仍在用，**保留**——只去掉文档那处用法），`PageResult` 从 `@lucy/shared` 引入。

```ts
/**
 * 页码分页的文档列表（详情页表格用）。
 * 与用户列表同一策略：`placeholderData` 保留上一页数据，翻页时不闪骨架；
 * 30 秒内切路由复用缓存，上传/删除经 invalidate 立即刷新。
 * kbId 变更时 queryKey 整块变化，内容自然重取。
 */
export function useDocumentList(
  kbId: string | undefined,
  query: DocumentListQuery = {},
) {
  return useQuery<PageResult<KnowledgeDocumentListItem>>({
    queryKey: knowledgeKeys.documentList(kbId ?? '', query),
    queryFn: () => listDocumentsApi(kbId!, query),
    enabled: !!kbId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
```

`hooks/use-knowledge.test.tsx`：
- import 里 `useInfiniteDocumentList` → `useDocumentList`；
- 两个工厂补 4 个字段；
- `describe('useInfiniteDocumentList')` 整段替换为：

```ts
describe('useDocumentList', () => {
  it('kbId 为空时禁用请求', () => {
    const { result } = renderHook(() => useDocumentList(undefined, {}), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.listDocumentsApi).not.toHaveBeenCalled();
  });

  it('按页码请求并返回 total；查询条件进入 queryKey', async () => {
    api.listDocumentsApi.mockResolvedValue({
      list: [makeDocListItem()],
      total: 42,
      page: 2,
      pageSize: 20,
    });
    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useDocumentList('kb1', { page: 2, pageSize: 20, keyword: 'x' }),
      { wrapper: createWrapperWithClient(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listDocumentsApi).toHaveBeenCalledWith('kb1', {
      page: 2,
      pageSize: 20,
      keyword: 'x',
    });
    expect(result.current.data?.total).toBe(42);
    // 分页参数是缓存键的一部分：换页不会命中上一页的缓存
    expect(
      client.getQueryData(
        knowledgeKeys.documentList('kb1', { page: 1, pageSize: 20 }),
      ),
    ).toBeUndefined();
  });
});
```

- [ ] **步骤 4：跑前端数据层测试**

运行：`pnpm --filter @lucy/frontend test src/api/knowledge.test.ts src/hooks/use-knowledge.test.tsx`
预期：PASS。

- [ ] **步骤 5：全仓验证并提交 1**

运行：`pnpm lint`、`pnpm typecheck`、`pnpm test`
预期：全部通过（提交钩子还会再跑一遍）。

```cmd
git add apps/backend apps/frontend packages/shared
git commit -F commit-msg.txt
```

提交信息（写到 `$COMMANDCODE_SCRATCHPAD/commit-msg.txt` 后用 `git commit -F`，shell 是 cmd 不支持 heredoc）：

```
feat(knowledge): 文档列表改为页码分页并补文件元数据

详情页的文件表格需要页码/总数/文件名/大小，游标分页与列表项契约都表达不了，
因此把 GET /knowledge/{kbId}/documents 换成 PageQueryDto + {list,total,page,pageSize}，
并在列表/详情契约各补 originalName/ext/mime/size（innerJoin files 列投影）。
前端数据层同步：useInfiniteDocumentList → useDocumentList。

Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

---

### 任务 6：`CardShell` 打开热区

**文件：**
- 修改：`apps/frontend/src/components/card-list/CardShell.tsx`
- 新建：`apps/frontend/src/components/card-list/CardShell.test.tsx`

- [ ] **步骤 1：写失败用例**

`apps/frontend/src/components/card-list/CardShell.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CardShell } from './CardShell';

describe('CardShell', () => {
  it('未传 openLink 时不渲染热区（模型供应商卡片不受影响）', () => {
    const { container } = render(
      <CardShell title="产品文档">正文</CardShell>,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('openLink 渲染为覆盖整卡的首个子元素（DOM 顺序在角标与操作栏之前）', () => {
    render(
      <CardShell
        title="产品文档"
        openLink={<a href="/knowledge/kb1">打开</a>}
        badge={<button type="button">公开</button>}
        actions={<button type="button">删除</button>}
      >
        正文
      </CardShell>,
    );

    const card = screen.getByText('产品文档').closest('div.relative');
    expect(card).not.toBeNull();
    const children = Array.from(card!.children);
    const openIndex = children.findIndex(
      (child) => child.tagName === 'A',
    );
    expect(openIndex).toBe(0);
    expect(children.findIndex((c) => c.tagName === 'DIV')).toBeGreaterThan(
      openIndex,
    );
  });

  it('角标与操作栏的点击不会被热区吃掉（DOM 在后者之上，无需 stopPropagation）', async () => {
    const onBadge = vi.fn();
    const onAction = vi.fn();
    render(
      <CardShell
        title="产品文档"
        openLink={<a href="/knowledge/kb1">打开</a>}
        badge={
          <button type="button" onClick={onBadge}>
            公开
          </button>
        }
        actions={
          <button type="button" onClick={onAction}>
            删除
          </button>
        }
      >
        正文
      </CardShell>,
    );

    await userEvent.click(screen.getByRole('button', { name: '公开' }));
    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onBadge).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **步骤 2：跑测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/components/card-list/CardShell.test.tsx`
预期：FAIL —— `openLink` 不是 `CardShell` 的 prop（TS 报错 / 热区不存在）。

- [ ] **步骤 3：实现**

`CardShell.tsx`：`CardShellProps` 增字段，解构增参数，并把 `{openLink}` 作为根节点内**第一个**子元素渲染：

```tsx
export type CardShellProps = {
  /** 卡片标题：固定一行、超出省略，原生 title 提供全名查看 */
  title: string;
  /**
   * 「打开」热区：传入后渲染为覆盖整卡的首个子元素（`absolute inset-0`）。
   *
   * 为什么能整卡可点、又不必给角标/操作栏加 stopPropagation：热区是**第一个**子元素，
   * 角标与操作栏在 DOM 中位于其后且都是定位元素，绘制顺序天然压住热区——点它们就是点它们。
   * 也不加 `z-index`：任何一处 z 值都可能与卡片自身的 hover 抬升打架。
   *
   * 刻意要求传**真锚点**（如 `<Link>`）而非回调：中键/⌘+点击可新标签页打开，
   * 键盘 Tab 也能聚焦；按钮式 `role="button"` 拿不到这些，且会把按钮嵌进按钮里。
   * 代价：卡片内的文本不可选中（被热区挡住），卡片描述本就是整块截断展示，可接受。
   */
  openLink?: ReactNode;
  /** 右上角角标（如公私状态）。存在时标题行自动留出其宽度，避免被角标盖住 */
  badge?: ReactNode;
  /** hover / 键盘聚焦时自卡片下缘滑入的操作栏内容 */
  actions?: ReactNode;
  /** 卡片主体 */
  children: ReactNode;
};

export const CardShell = ({
  title,
  openLink,
  badge,
  actions,
  children,
}: CardShellProps) => {
  return (
    <div className="group relative flex h-52.5 flex-col overflow-hidden rounded-lg bg-(--ant-color-bg-container) transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-(--ant-color-split)">
      {openLink}
      ...
```
其余标记一律不动。

- [ ] **步骤 4：跑测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/components/card-list/CardShell.test.tsx`
预期：PASS（3 个用例）。同时 `pnpm --filter @lucy/frontend test src/components/model-provider` 仍全绿（未传 `openLink`）。

---

### 任务 7：`KnowledgeCard` 透传热区 + 路由目录化

**文件：**
- 修改：`apps/frontend/src/components/knowledge/KnowledgeCard.tsx`、`KnowledgeCard.test.tsx`
- 新建：`apps/frontend/src/routes/_layout/knowledge.tsx`
- 新建（由现有文件移动）：`apps/frontend/src/routes/_layout/knowledge/index.tsx`、`knowledge/index.test.tsx`
- 删除：`apps/frontend/src/routes/_layout/knowledge.tsx`（原列表页内容）与其 `knowledge.test.tsx`

- [ ] **步骤 1：卡片补一条失败用例**

`KnowledgeCard.test.tsx` 加：

```tsx
  it('openLink 透传给 CardShell：整卡可点、且卡片本身不认识路由', () => {
    const { container } = renderCard({
      openLink: <a href="/knowledge/kb1">打开知识库</a>,
    });
    const link = screen.getByRole('link', { name: '打开知识库' });
    expect(link).toHaveAttribute('href', '/knowledge/kb1');
    // 热区是卡片内第一个子元素（角标/操作栏在其后，绘制在上）
    const card = link.parentElement;
    expect(card?.firstElementChild).toBe(link);
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });
```

运行：`pnpm --filter @lucy/frontend test src/components/knowledge/KnowledgeCard.test.tsx`
预期：FAIL —— `openLink` 不是 `KnowledgeCard` 的属性。

- [ ] **步骤 2：实现透传**

`KnowledgeCard.tsx`：`KnowledgeCardProps` 增 `openLink?: ReactNode;`（`import type { ReactNode } from 'react';`），解构增该参数并传给 `CardShell`。JSDoc 补一句：「热区由路由注入（卡片不认识 `/knowledge/$kbId`），与 mutation 提升到路由同一分工」。

运行：`pnpm --filter @lucy/frontend test src/components/knowledge/KnowledgeCard.test.tsx`
预期：PASS（17 个用例，含新增那条）。

- [ ] **步骤 3：路由目录化**

1. `git mv apps/frontend/src/routes/_layout/knowledge.tsx apps/frontend/src/routes/_layout/knowledge/index.tsx`
2. `git mv apps/frontend/src/routes/_layout/knowledge.test.tsx apps/frontend/src/routes/_layout/knowledge/index.test.tsx`
3. 新建 `apps/frontend/src/routes/_layout/knowledge.tsx`：

```tsx
import { createFileRoute, Outlet } from '@tanstack/react-router';

// 知识库的布局路由：只挂载子路由 Outlet，自身不渲染内容。
// 为什么必须有它：TanStack Router 会把 knowledge/$kbId.tsx 嵌在 knowledge.tsx 之下，
// 把列表页当布局的结果是「详情 URL 上也会渲染列表」。拆成 layout + index 后，
// 列表（/knowledge）与详情（/knowledge/$kbId）是同前缀的兄弟页，各自独占整页。
const KnowledgeLayout = () => {
  return <Outlet />;
};

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeLayout,
});
```

4. `knowledge/index.tsx`：
   - `createFileRoute('/_layout/knowledge')` → `createFileRoute('/_layout/knowledge/')`
   - 顶部补 `import { Link } from '@tanstack/react-router';`（与既有 `createFileRoute` 合并成一行 import）
   - `renderItem` 里给卡片注入热区：

```tsx
  const renderItem = useCallback(
    (kb: KnowledgeBase) => (
      <KnowledgeCard
        kb={kb}
        /* 热区是路由注入的真锚点：中键/⌘+点击可新标签页打开，卡片本身不认识路由 */
        openLink={
          <Link
            to="/knowledge/$kbId"
            params={{ kbId: kb.id }}
            aria-label={`打开知识库：${kb.name}`}
            title={kb.name}
          />
        }
        onEdit={handleEdit}
        onToggleLike={handleToggleLike}
        onToggleVisibility={handleToggleVisibility}
        onDelete={handleDelete}
        isLikePending={pendingIds.like === kb.id}
        isUpdatePending={pendingIds.update === kb.id}
        isDeletePending={pendingIds.delete === kb.id}
      />
    ),
    [
      handleDelete,
      handleEdit,
      handleToggleLike,
      handleToggleVisibility,
      pendingIds,
    ],
  );
```

5. `knowledge/index.test.tsx`：import 路径 `from './knowledge'` → `from './index'`；并补一个路由桩（列表里的卡片现在会渲染 `Link`，`Link` 需要 Router 上下文）：

```tsx
// 卡片热区是 <Link>：本文件按既有约定（见 routes/_layout.test.tsx）只替换需要的部分，
// createFileRoute / Route.options.component 保持真实
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, ...rest }: { to: string; params?: { kbId?: string } }) => (
    <a href={params?.kbId ? `${to.replace('$kbId', params.kbId)}` : to} {...rest} />
  ),
}));
```

并加一条用例：

```tsx
  it('卡片注入打开热区：指向该知识库详情', () => {
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    const link = screen.getByRole('link', { name: '打开知识库：产品文档' });
    expect(link).toHaveAttribute('href', '/knowledge/kb1');
    // 热区覆盖整卡、且不影响既有操作按钮
    expect(screen.getByRole('button', { name: '编辑知识库' })).toBeEnabled();
  });
```

- [ ] **步骤 4：重新生成路由树**

运行：`pnpm --filter @lucy/frontend build`
预期：构建通过；`git status` 显示 `src/routeTree.gen.ts` 被改写（新增 `/_layout/knowledge/$kbId`、`/_layout/knowledge/` 路由）。**不要手改该文件**。

- [ ] **步骤 5：跑列表路由测试**

运行：`pnpm --filter @lucy/frontend test src/routes/_layout/knowledge`
预期：PASS（原 22 条 + 新增 1 条）。

- [ ] **步骤 6：提交 2**

运行：`pnpm lint`、`pnpm typecheck`、`pnpm test` → 全绿后提交（提交信息写到 scratchpad 的 `commit-msg.txt`，用 `git commit -F`）：

```
feat(frontend): 知识库卡片可打开详情，列表页拆为 layout + index

CardShell 新增 openLink 覆盖热区（真锚点，角标/操作栏在其后自然压住热区，
不需要 stopPropagation 与 z-index），由路由注入以免卡片依赖路由；
knowledge.tsx 拆成纯 layout + index，为详情路由腾出兄弟位。

Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

---

### 任务 8：`formatBytes` 工具

**文件：**
- 修改：`apps/frontend/src/components/lib/utils.ts`、`apps/frontend/src/components/lib/utils.test.ts`

- [ ] **步骤 1：写失败用例**

`utils.test.ts` 追加：

```ts
describe('formatBytes', () => {
  it('按 1024 进制给出人类可读大小（B 无小数，其余保留 1 位）', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2 * 2.5)).toBe('2.5 MB');
  });

  it('非法输入兜底为 0 B（负数/NaN/Infinity）', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});
```

（import 补 `formatBytes`。）

- [ ] **步骤 2：跑测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/components/lib/utils.test.ts`
预期：FAIL —— `formatBytes is not a function`。

- [ ] **步骤 3：实现**

`utils.ts` 追加：

```ts
/** 1024 进制的单位表（B 不显示小数，其余保留 1 位） */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 把字节数格式化为人类可读大小（详情页文件表格用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exp;
  return `${exp === 0 ? String(value) : value.toFixed(1)} ${BYTE_UNITS[exp] ?? 'B'}`;
}
```

- [ ] **步骤 4：跑测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/components/lib/utils.test.ts`
预期：PASS。

---

### 任务 9：详情页工具条与解析文本抽屉

> 相对规格的一处简化：规格把「页头（返回 + 知识库信息 + 上传）」与「搜索框」写成两块；
> 实现上合并成**同一个 `FullBleedBar`**（左侧返回 + 信息，右侧上传 + 搜索），
> 避免两片都带 `shadow-lg` 的横条上下叠放。信息与入口一个不少。

**文件：**
- 新建：`apps/frontend/src/components/knowledge/DocumentToolbar.tsx` + `DocumentToolbar.test.tsx`
- 新建：`apps/frontend/src/components/knowledge/DocumentTextDrawer.tsx` + `DocumentTextDrawer.test.tsx`

- [ ] **步骤 1：写工具条用例**

`DocumentToolbar.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentToolbar } from './DocumentToolbar';

function renderToolbar(overrides: Partial<Parameters<typeof DocumentToolbar>[0]> = {}) {
  const props = {
    kbName: '产品文档',
    kbDescription: '这是一段描述',
    backLink: <a href="/knowledge">返回</a>,
    onSearch: vi.fn(),
    onUpload: vi.fn(),
    isUploading: false,
    ...overrides,
  };
  return { ...render(<DocumentToolbar {...props} />), props };
}

describe('DocumentToolbar', () => {
  it('展示知识库名称与描述，并渲染路由注入的返回入口', () => {
    renderToolbar();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回' })).toBeInTheDocument();
  });

  it('知识库信息未就绪时占位，不渲染空标题', () => {
    renderToolbar({ kbName: undefined, kbDescription: undefined });
    expect(screen.getByText('知识库')).toBeInTheDocument();
  });

  it('搜索回调收到 trim 后的关键字', async () => {
    const { props } = renderToolbar();
    await userEvent.type(
      screen.getByPlaceholderText('按文件名或内容搜索'),
      '  正文  ',
    );
    await userEvent.keyboard('{Enter}');
    expect(props.onSearch).toHaveBeenCalledWith('正文');
  });

  it('选择文件后回调 onUpload（不自动发请求：beforeUpload 返回 false）', async () => {
    const { props, container } = renderToolbar();
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    await userEvent.upload(input as HTMLInputElement, file);
    expect(props.onUpload).toHaveBeenCalledWith(file);
  });

  it('上传中禁用上传按钮', () => {
    renderToolbar({ isUploading: true });
    expect(screen.getByRole('button', { name: /上传文档/ })).toBeDisabled();
  });
});
```

- [ ] **步骤 2：实现工具条**

`apps/frontend/src/components/knowledge/DocumentToolbar.tsx`：

```tsx
import { FullBleedBar } from '@/components/full-bleed-bar';
import { Button, Input, Upload } from 'antd';
import type { FC, ReactNode } from 'react';

// 与后端 content-extractor.ts 的 SUPPORTED_DOCUMENT_EXTS 对齐（后端仍会再校验一次扩展名与大小，
// 这里只是把明显不支持的格式挡在选择框外）
const ACCEPT = '.txt,.md,.pdf,.docx';

export type DocumentToolbarProps = {
  /** 知识库名称/描述：详情尚未就绪时为 undefined，占位显示「知识库」 */
  kbName?: string;
  kbDescription?: string;
  /** 返回列表的入口：由路由注入（工具条不认识路由，与卡片热区同一分工） */
  backLink: ReactNode;
  /** 关键字搜索（已 trim）；由路由重置到第 1 页 */
  onSearch: (value: string) => void;
  /** 选中文件后回调（上传由路由持有的 mutation 执行） */
  onUpload: (file: File) => void;
  /** 上传进行中：禁用入口，避免并发上传同一个知识库 */
  isUploading: boolean;
};

/**
 * 知识库详情页的工具条：左侧返回入口 + 知识库信息，右侧上传文档 + 关键字搜索。
 * 与列表页的 `KnowledgeToolbar` 同款外壳（FullBleedBar + lucy-page-gutter + z-10），
 * 保证两页的内容左缘与标题栏高度一致。
 */
export const DocumentToolbar: FC<DocumentToolbarProps> = ({
  kbName,
  kbDescription,
  backLink,
  onSearch,
  onUpload,
  isUploading,
}) => (
  <FullBleedBar
    bleedToViewport={false}
    className="lucy-page-gutter z-10 shrink-0 py-6 shadow-lg"
  >
    <div className="flex min-w-0 items-center gap-3">
      {backLink}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-base font-semibold">
          {kbName ?? '知识库'}
        </span>
        {kbDescription ? (
          <span className="truncate text-xs text-gray-500">
            {kbDescription}
          </span>
        ) : null}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-4">
      <Upload
        accept={ACCEPT}
        showUploadList={false}
        disabled={isUploading}
        // 返回 false 阻止 antd 自动上传：请求由路由的 useAddDocument 发起（带 Bearer 与信封解包）
        beforeUpload={(file) => {
          onUpload(file);
          return false;
        }}
      >
        <Button loading={isUploading} disabled={isUploading}>
          上传文档
        </Button>
      </Upload>
      <Input.Search
        allowClear
        placeholder="按文件名或内容搜索"
        className="w-60"
        onSearch={(value) => onSearch(value.trim())}
      />
    </div>
  </FullBleedBar>
);
```

- [ ] **步骤 3：跑工具条测试**

运行：`pnpm --filter @lucy/frontend test src/components/knowledge/DocumentToolbar.test.tsx`
预期：PASS（5 个用例）。

- [ ] **步骤 4：写抽屉用例**

`DocumentTextDrawer.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocument } from '@/hooks/use-knowledge';
import { DocumentTextDrawer } from './DocumentTextDrawer';

vi.mock('@/hooks/use-knowledge', () => ({ useDocument: vi.fn() }));

const mockedUseDocument = vi.mocked(useDocument);

const row = {
  id: 'd1',
  knowledgeBaseId: 'kb1',
  fileId: 'f1',
  title: 'intro',
  originalName: 'intro.md',
  ext: '.md',
  mime: 'text/markdown',
  size: 1024,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function noopQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useDocument>;
}

describe('DocumentTextDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseDocument.mockReturnValue(noopQuery());
  });

  it('未选中文档时关闭且不请求详情', () => {
    render(<DocumentTextDrawer kbId="kb1" doc={null} onClose={vi.fn()} />);
    expect(mockedUseDocument).toHaveBeenCalledWith('kb1', undefined);
  });

  it('选中文档时以文件名作标题，展示解析全文', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      data: { ...row, content: '解析出来的正文' },
    } as unknown as ReturnType<typeof useDocument>);

    render(<DocumentTextDrawer kbId="kb1" doc={row} onClose={vi.fn()} />);

    expect(await screen.findByText('intro.md')).toBeInTheDocument();
    expect(screen.getByText('解析出来的正文')).toBeInTheDocument();
  });

  it('解析文本为空时给出占位文案', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      data: { ...row, content: null },
    } as unknown as ReturnType<typeof useDocument>);

    render(<DocumentTextDrawer kbId="kb1" doc={row} onClose={vi.fn()} />);

    expect(await screen.findByText('（没有可展示的解析文本）')).toBeInTheDocument();
  });

  it('加载失败时展示服务端文案', async () => {
    const error = Object.assign(new Error('文档不存在'), {
      name: 'ApiError',
      status: 404,
    });
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      isError: true,
      error,
    } as unknown as ReturnType<typeof useDocument>);

    render(<DocumentTextDrawer kbId="kb1" doc={row} onClose={vi.fn()} />);

    expect(await screen.findByText('文档不存在')).toBeInTheDocument();
  });
});
```

- [ ] **步骤 5：实现抽屉**

`apps/frontend/src/components/knowledge/DocumentTextDrawer.tsx`：

```tsx
import { errorMessageOf } from '@/api/client';
import type { KnowledgeDocumentListItem } from '@/api/types';
import { useDocument } from '@/hooks/use-knowledge';
import { Drawer, Result, Spin } from 'antd';
import type { FC } from 'react';

export type DocumentTextDrawerProps = {
  kbId: string;
  /** 目标文档：null 表示关闭。传列表项即可（标题用原始文件名，不必等详情） */
  doc: KnowledgeDocumentListItem | null;
  onClose: () => void;
};

/**
 * 解析文本抽屉：展示文档的解析全文（`useDocument` 只在打开时按 id 拉取）。
 * 正文可达 MB 级，故用 `whitespace-pre-wrap` + 抽屉自身滚动，不做代码高亮或富文本。
 */
export const DocumentTextDrawer: FC<DocumentTextDrawerProps> = ({
  kbId,
  doc,
  onClose,
}) => {
  const query = useDocument(kbId, doc?.id);

  return (
    <Drawer
      title={doc?.originalName ?? ''}
      open={!!doc}
      onClose={onClose}
      destroyOnHidden
      width={640}
    >
      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spin />
        </div>
      ) : query.isError ? (
        <Result
          status="error"
          title="解析文本加载失败"
          subTitle={errorMessageOf(query.error, '请稍后重试')}
        />
      ) : (
        <div className="text-sm break-words whitespace-pre-wrap">
          {query.data?.content || '（没有可展示的解析文本）'}
        </div>
      )}
    </Drawer>
  );
};
```

- [ ] **步骤 6：跑抽屉测试**

运行：`pnpm --filter @lucy/frontend test src/components/knowledge/DocumentTextDrawer.test.tsx`
预期：PASS（4 个用例）。

---

### 任务 10：详情路由（表格 + 上传 + 抽屉接线）

**文件：**
- 新建：`apps/frontend/src/routes/_layout/knowledge/$kbId.tsx`
- 新建：`apps/frontend/src/routes/_layout/knowledge/$kbId.test.tsx`

- [ ] **步骤 1：写路由用例**

`$kbId.test.tsx`：

```tsx
import type { KnowledgeDocumentListItem } from '@/api/types';
import { useAddDocument, useDeleteDocument, useDocument, useDocumentList, useKnowledgeBase } from '@/hooks/use-knowledge';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeDetailPage } from './$kbId';

// 工具条里的返回入口与卡片热区是 <Link>：渲染成裸 <a>（其余路由 API 保持真实）
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, ...rest }: { to: string }) => <a href={to} {...rest} />,
}));

vi.mock('@/hooks/use-knowledge', () => ({
  KNOWLEDGE_PAGE_SIZE: 20,
  useKnowledgeBase: vi.fn(),
  useDocumentList: vi.fn(),
  useDocument: vi.fn(),
  useAddDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
}));

const messageError = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const mod = await importOriginal<typeof import('antd')>();
  const useApp = () => {
    const real = mod.App.useApp();
    return { ...real, message: { ...real.message, error: messageError } };
  };
  return { ...mod, App: { ...mod.App, useApp } };
});

/* ==== 夹具与桩：hook 全部由用例控制，页面组件直接渲染（kbId 走 prop，不需要 Router） ==== */
const mockedKb = vi.mocked(useKnowledgeBase);
const mockedList = vi.mocked(useDocumentList);
const mockedDoc = vi.mocked(useDocument);
const mockedAdd = vi.mocked(useAddDocument);
const mockedDelete = vi.mocked(useDeleteDocument);

function makeRow(
  id = 'd1',
  over: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem {
  return {
    id,
    knowledgeBaseId: 'kb1',
    fileId: 'f1',
    title: 'intro',
    originalName: 'intro.md',
    ext: '.md',
    mime: 'text/markdown',
    size: 1024,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

const refetch = vi.fn();

/** 文档列表查询桩：页码固定回显 1（断言只看传进去的 page） */
function mockList(list: KnowledgeDocumentListItem[], total: number) {
  mockedList.mockReturnValue({
    data: { list, total, page: 1, pageSize: 20 },
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  } as never);
}

/** 变更 hook 桩：返回可断言的句柄（mutateAsync 由用例控制实现） */
function mockMutation(
  target: typeof mockedAdd | typeof mockedDelete,
  mutateAsync = vi.fn().mockResolvedValue(undefined),
) {
  const handle = { mutateAsync, isPending: false, variables: undefined };
  target.mockReturnValue(handle as never);
  return handle;
}

function renderPage() {
  return render(
    <AntdApp>
      <KnowledgeDetailPage kbId="kb1" />
    </AntdApp>,
  );
}

describe('routes/_layout/knowledge/$kbId', () => {
  let addHandle: ReturnType<typeof mockMutation>;
  let deleteHandle: ReturnType<typeof mockMutation>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedKb.mockReturnValue({
      data: { name: '产品文档', description: '这是一段描述' },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    mockList([makeRow()], 1);
    mockedDoc.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    addHandle = mockMutation(mockedAdd);
    deleteHandle = mockMutation(mockedDelete);
  });

  it('渲染文件表格：文件名/类型/大小/上传时间', () => {
    renderPage();

    expect(mockedList).toHaveBeenCalledWith('kb1', {
      page: 1,
      pageSize: 20,
      keyword: undefined,
    });
    expect(screen.getByText('intro.md')).toBeInTheDocument();
    expect(screen.getByText('.md')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01 00:00')).toBeInTheDocument();
  });

  it('搜索：回到第 1 页并把 trim 后的关键字交给查询', async () => {
    renderPage();

    await userEvent.type(
      screen.getByPlaceholderText('按文件名或内容搜索'),
      ' 正文 ',
    );
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith('kb1', {
        page: 1,
        pageSize: 20,
        keyword: '正文',
      }),
    );
  });

  it('翻页：把 page 交给查询', async () => {
    mockList(
      Array.from({ length: 20 }, (_, i) => makeRow(`row-${i}`)),
      40,
    );
    renderPage();

    await userEvent.click(screen.getByTitle('2'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith('kb1', {
        page: 2,
        pageSize: 20,
        keyword: undefined,
      }),
    );
  });

  it('删除：确认后才调接口；失败时提示服务端文案', async () => {
    deleteHandle.mutateAsync.mockRejectedValue(
      Object.assign(new Error('文档不存在'), { name: 'ApiError', status: 404 }),
    );
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(
      screen.getByText('确定要删除「intro.md」吗？此操作不可恢复。'),
    ).toBeInTheDocument();
    expect(deleteHandle.mutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(deleteHandle.mutateAsync).toHaveBeenCalledWith({
        kbId: 'kb1',
        id: 'd1',
      }),
    );
    expect(await screen.findByText('文档不存在')).toBeInTheDocument();
  });

  it('末页最后一条被删时先回退页码，避免拉到空页', async () => {
    // 共 21 条 → 共 2 页；第 2 页只有 1 行
    mockList([makeRow('last')], 21);
    renderPage();

    await userEvent.click(screen.getByTitle('2'));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 2 }),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(deleteHandle.mutateAsync).toHaveBeenCalledWith({
        kbId: 'kb1',
        id: 'last',
      }),
    );
    // 先回退页码再删：invalidate 后的重拉直接命中第 1 页，不会先拉空页
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 1 }),
      ),
    );
  });

  it('上传：选中文件后调用 addDocument 并回到第 1 页', async () => {
    mockList([makeRow('last')], 21);
    const { container } = renderPage();

    await userEvent.click(screen.getByTitle('2'));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 2 }),
      ),
    );

    const file = new File(['hi'], 'a.md', { type: 'text/markdown' });
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      file,
    );

    await waitFor(() =>
      expect(addHandle.mutateAsync).toHaveBeenCalledWith({ kbId: 'kb1', file }),
    );
    // 新文档排在最前：上传后回到第 1 页
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 1 }),
      ),
    );
  });

  it('上传失败：提示服务端文案', async () => {
    addHandle.mutateAsync.mockRejectedValue(
      Object.assign(new Error('不支持的文档类型，仅支持 txt/md/pdf/docx'), {
        name: 'ApiError',
        status: 415,
      }),
    );
    const { container } = renderPage();

    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['hi'], 'a.exe'),
    );

    expect(
      await screen.findByText('不支持的文档类型，仅支持 txt/md/pdf/docx'),
    ).toBeInTheDocument();
  });

  it('查看：打开抽屉并展示解析全文', async () => {
    mockedDoc.mockReturnValue({
      data: { ...makeRow(), content: '解析正文' },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '查看' }));

    expect(await screen.findByText('解析正文')).toBeInTheDocument();
  });

  it('文档列表失败：就地展示错误与重试，不改整页', async () => {
    mockedList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('知识库不存在'), {
        name: 'ApiError',
        status: 404,
      }),
      refetch,
    } as never);
    renderPage();

    expect(screen.getByText('文档加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('知识库详情加载失败：整页错误态 + 返回列表入口，不渲染表格', () => {
    mockedKb.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('知识库不存在'), {
        name: 'ApiError',
        status: 404,
      }),
    } as never);
    renderPage();

    expect(screen.getByText('知识库不存在')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '返回知识库列表' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
```

（`import type { KnowledgeDocumentListItem } from '@/api/types';` 与 `beforeEach/describe/expect/it/vi` 等 import 见上文；`useAddDocument`/`useDeleteDocument` 的桩都用 `never` 断言，因为测试只关心被调用的入参。）

- [ ] **步骤 2：跑测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/routes/_layout/knowledge/$kbId.test.tsx`
预期：FAIL —— 模块不存在。

- [ ] **步骤 3：实现详情页**

`apps/frontend/src/routes/_layout/knowledge/$kbId.tsx`：

```tsx
import { errorMessageOf } from '@/api/client';
import type { KnowledgeDocumentListItem } from '@/api/types';
import { formatBytes } from '@/components/lib/utils';
import { DocumentTextDrawer } from '@/components/knowledge/DocumentTextDrawer';
import { DocumentToolbar } from '@/components/knowledge/DocumentToolbar';
import { PageShell } from '@/components/page-shell';
import {
  KNOWLEDGE_PAGE_SIZE,
  useAddDocument,
  useDeleteDocument,
  useDocumentList,
  useKnowledgeBase,
} from '@/hooks/use-knowledge';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { createFileRoute, Link } from '@tanstack/react-router';
import { App, Button, Empty, Result } from 'antd';
import dayjs from 'dayjs';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';

export type KnowledgeDetailPageProps = { kbId: string };

/**
 * 知识库详情页：页头是知识库信息与上传入口，主体是文档（文件）表格。
 *
 * kbId 由路由传入而不是在组件里读 `Route.useParams()`：路由层保持 3 行薄壳，
 * 页面本身可以不依赖 Router 上下文被直接渲染（路由用例只 mock 掉 `Link`）。
 */
export const KnowledgeDetailPage: FC<KnowledgeDetailPageProps> = ({ kbId }) => {
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [viewing, setViewing] = useState<KnowledgeDocumentListItem | null>(null);
  const [uploading, setUploading] = useState(false);

  const kbQuery = useKnowledgeBase(kbId);
  const listQuery = useMemo(
    () => ({ page, pageSize: KNOWLEDGE_PAGE_SIZE, keyword: keyword || undefined }),
    [page, keyword],
  );
  const query = useDocumentList(kbId, listQuery);
  const rows = useMemo(() => query.data?.list ?? [], [query.data]);

  const { mutateAsync: addDocument } = useAddDocument();
  const { mutateAsync: removeDocument } = useDeleteDocument();

  // 删除确认框的 onOk 在闭包里执行：用 ref 读最新的页码与行数，
  // 避免回调依赖 page/rows 每轮重建（连带 columns memo 失效）。写入放 effect（见 users 页同款说明）。
  const pageRef = useRef(page);
  const rowsRef = useRef(rows);
  useEffect(() => {
    pageRef.current = page;
    rowsRef.current = rows;
  }, [page, rows]);

  const handleDelete = useCallback(
    (doc: KnowledgeDocumentListItem) => {
      modal.confirm({
        title: '删除文档',
        content: `确定要删除「${doc.originalName}」吗？此操作不可恢复。`,
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          // 末页最后一条被删时先回退页码再删：invalidate 的重拉直接命中目标页，
          // 只有一次列表请求，避免先拉空页再翻页的闪动
          if (rowsRef.current.length <= 1 && pageRef.current > 1) {
            setPage(pageRef.current - 1);
          }
          return removeDocument({ kbId, id: doc.id }).catch((e: unknown) => {
            message.error(errorMessageOf(e, '删除失败，请稍后重试'));
            throw e;
          });
        },
      });
    },
    [kbId, message, modal, removeDocument],
  );

  /** 上传：成功后回到第 1 页（新文档排在最前），成功提示由后端 message 经全局桥弹出 */
  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        await addDocument({ kbId, file });
        setPage(1);
      } catch (e) {
        message.error(errorMessageOf(e, '上传失败，请稍后重试'));
      } finally {
        setUploading(false);
      }
    },
    [addDocument, kbId, message],
  );

  const columns: ProColumns<KnowledgeDocumentListItem>[] = useMemo(
    () => [
      { title: '文件名', dataIndex: 'originalName', ellipsis: true },
      { title: '类型', dataIndex: 'ext', width: 100 },
      {
        title: '大小',
        dataIndex: 'size',
        width: 120,
        render: (_, record) => formatBytes(record.size),
      },
      {
        title: '上传时间',
        dataIndex: 'createdAt',
        width: 180,
        render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 140,
        render: (_, record) => [
          <Button
            key="view"
            type="link"
            size="small"
            onClick={() => setViewing(record)}
          >
            查看
          </Button>,
          <Button
            key="delete"
            type="link"
            size="small"
            danger
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>,
        ],
      },
    ],
    [handleDelete],
  );

  // 知识库不存在/无权访问：整页错误态（此时文档列表必然也拿不到，不必再渲染表格）
  if (kbQuery.isError) {
    return (
      <PageShell>
        <Result
          status="error"
          title="知识库加载失败"
          subTitle={errorMessageOf(kbQuery.error, '请稍后重试')}
          extra={
            <Link to="/knowledge" aria-label="返回知识库列表">
              返回知识库列表
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell height="fill">
      <DocumentToolbar
        kbName={kbQuery.data?.name}
        kbDescription={kbQuery.data?.description}
        backLink={
          <Link
            to="/knowledge"
            aria-label="返回知识库列表"
            title="返回知识库列表"
            className="flex size-8 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:text-[#45b7d1]"
          >
            <ArrowLeftOutlined />
          </Link>
        }
        onSearch={(value) => {
          setKeyword(value);
          setPage(1);
        }}
        onUpload={(file) => void handleUpload(file)}
        isUploading={uploading}
      />
      <div className="min-h-0 flex-1 py-4">
        {query.isError ? (
          <Result
            status="error"
            title="文档加载失败"
            subTitle={errorMessageOf(query.error, '请稍后重试')}
            extra={
              <Button type="link" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : (
          <ProTable<KnowledgeDocumentListItem>
            rowKey="id"
            loading={query.isLoading}
            dataSource={rows}
            columns={columns}
            search={false}
            options={false}
            dateFormatter="string"
            pagination={{
              current: page,
              pageSize: KNOWLEDGE_PAGE_SIZE,
              total: query.data?.total ?? 0,
              showSizeChanger: false,
              onChange: (next) => setPage(next),
            }}
            locale={{
              emptyText: (
                <Empty
                  className="py-16"
                  description={
                    keyword ? '没有匹配的文档' : '暂无文档，可上传'
                  }
                />
              ),
            }}
          />
        )}
      </div>
      <DocumentTextDrawer
        kbId={kbId}
        doc={viewing}
        onClose={() => setViewing(null)}
      />
    </PageShell>
  );
};

export const Route = createFileRoute('/_layout/knowledge/$kbId')({
  component: KnowledgeDetailRoute,
});

function KnowledgeDetailRoute() {
  const { kbId } = Route.useParams();
  return <KnowledgeDetailPage kbId={kbId} />;
}
```

- [ ] **步骤 4：跑路由测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/routes/_layout/knowledge`
预期：PASS（列表 + 详情两个文件）。

- [ ] **步骤 5：重新生成路由树并全仓验证**

运行：`pnpm --filter @lucy/frontend build`（重建 `routeTree.gen.ts`）
运行：`pnpm lint`、`pnpm typecheck`、`pnpm test`
预期：全绿。

- [ ] **步骤 6：提交 3**

（提交信息写到 scratchpad 的 `commit-msg.txt`，用 `git commit -F`）

```
feat(frontend): 知识库详情页（文件表格 + 上传 + 解析文本抽屉）

新增 /knowledge/$kbId：页头知识库信息与上传入口、ProTable 文件表格
（文件名/类型/大小/上传时间/查看/删除）、关键字搜索、末页删除回退页码。
含 formatBytes 工具与详情路由、工具条、抽屉的单测。

Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

---

### 任务 11：前端 e2e 冒烟补详情页路由

**文件：**
- 修改：`apps/frontend/e2e/smoke.spec.ts`

- [ ] **步骤 1：stubApi 分支出文档列表与单个知识库**

`stubApi` 里把 `if (url.includes('/knowledge'))` 替换成（顺序要紧：先 `/documents`，再单个知识库，最后列表）：

```ts
    // 顺序要紧：/knowledge/{id}/documents 也包含 '/knowledge'
    if (url.includes('/documents')) {
      return route.fulfill(
        envelope({
          list: [fakeDocument()],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      );
    }
    // 单个知识库详情：/knowledge/{id}（列表是 /knowledge 或 /knowledge?…）
    if (/\/knowledge\/[^/?]+$/.test(url)) {
      return route.fulfill(envelope(fakeKnowledgeBase(1)));
    }
    if (url.includes('/knowledge')) {
      return route.fulfill(
        envelope({ ...EMPTY_PAGE, list: [1, 2, 3].map(fakeKnowledgeBase) }),
      );
    }
```

并在 `fakeKnowledgeBase` 之后加：

```ts
/** 文档列表项（详情页文件表格）：字段集与 KnowledgeDocumentListItemDto 一致 */
const fakeDocument = () => ({
  id: 'd1',
  knowledgeBaseId: 'kb1',
  fileId: 'f1',
  title: 'intro',
  originalName: 'intro.md',
  ext: '.md',
  mime: 'text/markdown',
  size: 1024,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});
```

- [ ] **步骤 2：加路由用例**

`ROUTES` 里 `/knowledge` 之后插入：

```ts
  {
    path: '/knowledge/kb1',
    title: '知识库 - Lucy',
    // 「上传文档」是详情页工具条里的固定入口，白屏/运行时异常会让它超时失败
    anchor: 'text=上传文档',
  },
```

- [ ] **步骤 3：跑冒烟**

运行：`pnpm --filter @lucy/frontend test:e2e`
（首次需 `pnpm --filter @lucy/frontend exec playwright install chromium`）
预期：全部用例通过，含新增的 `/knowledge/kb1 打开无报错`。

- [ ] **步骤 4：提交 4**

```
test(frontend): e2e 冒烟补知识库详情页路由

冒烟逐个枚举路由，新增 /knowledge/$kbId 必须同步：stubApi 分支出
/documents 与单个知识库详情，并加一条用例断言页面渲染无控制台报错。

Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

---

### 任务 12：收尾验证

- [ ] **步骤 1：跑完 CI 会跑的全部检查**

```cmd
pnpm --filter @lucy/shared build
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @lucy/backend test:e2e
pnpm --filter @lucy/frontend test:e2e
```

预期：全绿。`pnpm test` 的覆盖率门槛 80% 由新增文件带上来的用例满足（新文件的每个分支都有对应用例）。

- [ ] **步骤 2：核对生成文件已入库**

运行：`git status`
预期：`packages/shared/src/generated/openapi.ts`、`apps/frontend/src/routeTree.gen.ts` 的改动都已包含在提交里（pre-commit 会再生成一遍并 stage）。

- [ ] **步骤 3：确认无残留后台进程**

若为跑 e2e 起过 `docker compose up -d`，按需 `docker compose down`；确认没有遗留的 dev server 占用端口。

---

## 风险与回退

| 风险 | 表现 | 处置 |
| --- | --- | --- |
| `innerJoin + addSelect` 未水合 `doc.file` | e2e 里 `originalName` 为空串、`size` 为 0 | 改用 `leftJoinAndSelect('d.file', 'f')`（映射仍是白名单，`key`/`hash` 不会出网），并同步 service spec 的列投影断言 |
| ProTable 在 jsdom 下的分页交互不稳定 | 翻页用例点不到第 2 页 | 用例改为直接驱动 `pagination.onChange`（从 `lastGridProps` 式的外部捕获拿到），保留「page 进查询 Key」这一要点 |
| 冒烟标题假设不成立（`/knowledge/kb1` 的文档标题可能不是 `知识库 - Lucy`） | 该用例 title 断言失败 | 按实际渲染结果修 title 期望值（锚点断言与「无控制台报错」是这条用例的真正价值） |
| `Empty`/`Result` 在 ProTable 的 `locale.emptyText` 下不渲染 | 空态用例找不到文案 | 改为直接断言 `query.data.total === 0` 时不渲染行，并在组件测试里单独覆盖空态分支 |
| 覆盖率门禁（前端 80%、Sonar new_coverage 80%） | `pnpm test` 或质量门禁红 | 新增文件补齐分支用例；`formatBytes` 的非法输入分支、抽屉的三种状态、详情页的错误态都已单独覆盖 |

## 已知取舍（写进 PR 正文）

- 页码（OFFSET）分页在翻页期间有写入时会出现重复/漏项，keyset 不会——这是表格要页码与总数的代价，且知识库**列表**仍是游标分页。
- 卡片热区会挡住卡内文本选中；卡片描述本就是整块截断展示。
- 上传的 `accept` 列表与后端 `SUPPORTED_DOCUMENT_EXTS` 是两处字面量（前端只做初筛，后端仍会校验扩展名/大小/魔数）；若要单一来源需把它挪进 `@lucy/shared`，本次不做。
- 不做：下载原文件（需新端点）、批量/拖拽上传、表格排序。
