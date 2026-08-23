# 知识库后端设计文档（含通用文件模块 @coool/file-nest）

- **日期**：2026-08-23
- **状态**：待批准
- **范围**：档位 A（CRUD 管理）——知识库/文档两级结构，支持 .txt/.md/.pdf/.docx 上传，本地存原文件 + 解析文本入库；用户私有 + 可见性（私有/公开），非属主共享库只读
- **明确不做**（后续迭代）：chunk 切片、embedding 向量化、向量存储、RAG 检索增强对话、指定用户共享（仅保留公开/私有两档）、多租户

## 背景与目标

backend 目前无任何知识库/文档/向量相关代码（grep 仅命中无关的 `chunk` 变量）。Chat 模块（`apps/backend/src/ai/`，LangChain + Ollama）已就绪，为后续「AI 基于知识库作答」打地基，本期先落地知识库的**内容管理**能力。

目标：

1. 抽取**可复用的 NestJS 文件管理库** `@coool/file-nest`（monorepo 包，VitePress 文档，可独立发布），为将来头像、聊天附件、文档等多应用复用。
2. backend 新增 `knowledge` 模块：两级（知识库 → 文档）+ 文件上传 + 解析 + 权限。

## 决策记录

1. **两级结构**（`KnowledgeBase` → `KnowledgeDocument`），不做扁平；前端可分组浏览，贴近真实知识库。
2. **支持文件上传 + 解析**：.txt/.md 直接读字符串，.pdf 用 `pdf-parse`，.docx 用 `mammoth`；原始文件落本地磁盘，提取的纯文本入库 `content` 列（为后续 RAG 直接读 DB）。
3. **用户私有 + 可见性开关**：`visibility = private | public`；`public` 对所有登录用户只读。写操作（创建/编辑/删除 KB、文档，上传）**仅属主**——共享来的库非属主一律只读（不做指定用户共享，YAGNI）。
4. **先抽通用 FileModule（方案三）**——用户明确「为后面功能扩展做好准备」。FileModule 是建立在成熟 OSS 之上的薄胶水（multer 上传由消费端处理），非重新发明。
5. **FileModule 抽成 monorepo 包** `@coool/file-nest`，镜像 `@coool/redis-nest` 的构建/文档/发布约定。
6. **存储驱动抽象**：本期实现 `LocalStorageDriver`（本地磁盘）；预留 `StorageDriver` 接口，将来加 `S3StorageDriver`（`@aws-sdk/client-s3`）即插即换。
7. **HTTP multipart 上传**由知识库 controller 用 Nest 内置 `FileInterceptor`（底层 multer，backend 已有 `@nestjs/platform-express`）处理；file-nest 保持存储无关（不依赖 platform-express）。
8. **文件类型校验用 `file-type` 魔数嗅探**，防伪装扩展名（如 html 改名为 .txt）。

## 架构

### 1. 包身份与目录（packages/file-nest）

- 目录 `packages/file-nest`，包名 `@coool/file-nest`，版本 `0.1.0`，MIT。
- 镜像 `packages/redis`：
  - `package.json`：`"type":"module"`、`exports`（`import`/`require` 双分支，`types`→`src/index.ts`，`default`→`dist`）、`main`/`types`、`files:["dist"]`。
  - 脚本：`build`（tsup `esm,cjs` + `--dts`）、`dev`（watch）、`docs:build`/`docs:dev`（vitepress）、`lint --fix`、`prepublishOnly`（build+test）、`test`/`test:cov`（vitest）、`typecheck`。
  - `docs/`：VitePress，`docs/.vitepress/config.ts`（lang zh-CN、标题、nav 指南/路线图、sidebar 分节、socialLinks、footer），`docs/index.md` + `docs/guide/*.md`。配套 `docs:dev`/`docs:build` 脚本与 `README`。
  - `tsconfig.json` + `tsconfig.build.json`、`vitest.config.ts`、`eslint.config.mjs`、`src/*.test.ts` 伴生测试。
- `peerDependencies`：`@nestjs/common`、`@nestjs/core`、`@nestjs/typeorm`、`typeorm`；`devDependencies` 装同版本供测试。
- `dependencies`：`file-type`、`pdf-parse`、`mammoth`。（不依赖 `@nestjs/platform-express`/`multer`，保持存储无关）

### 2. file-nest 组成

**`StorageDriver` 接口**（存储无关的读写抽象）：

```ts
export interface StoredFile {
  [k: string]: unknown;
}
export interface StorageDriver {
  write(key: string, data: Buffer): Promise<void> | void;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void> | void;
}
```

**`LocalStorageDriver`**：写 `uploads/<key>`，`key` 为 `FileEntity.id + "." + ext`；`withConfig({ dir })` 注入目录（默认 `process.env.UPLOAD_DIR ?? 'uploads'`）。保证 `dir` 存在（`mkdir -p`）。

**`FileEntity`**（`@Entity('files')`，TypeORM）：

- `id`：`@PrimaryGeneratedColumn('uuid')`
- `ownerId`：`@Column({ name:'owner_id', type:'uuid' })`（文件的属主，用于权限）
- `originalName`、`ext`、`mime`、`size`（int）
- `key`（存储路径，相对 storage 根）、`hash`（校验和，可选，用 `crypto` sha256，用于去重/校验）
- `storage`（string，标识所用 driver，本期 `'local'`，将来扩展 `'s3'`）
- `@CreateDateColumn`/`@UpdateDateColumn`（timestamptz）

**`FileService`**：

- `save(input: { ownerId, originalName, mime, size, buffer, storage? })`：校验 → 算 hash → 生成 `id` → 写 driver → 落 FileEntity 元数据，返回实体。
- `validate(buffer, originalName)`：用 `file-type` 魔数嗅探真实 mime + 扩展名白名单 `['txt','md','pdf','docx']` + 大小上限（`FILE_MAX_SIZE`，默认如 10MB）。非法抛 `BusinessException`。
- `delete(file)`：删除 driver 中的文件 + 删除元数据。
- `stream/file` 读取 API：`read(file)` 返回 Buffer（供下载/预览）。
- 注：**不内置解析**（pdf-parse/mammoth 是文档模块的职责，file-nest 保持通用，不含「解析为文本」这种知识库特定逻辑）。

**`FileModule`**：

- `forRootAsync({ useFactory })`：注入 `StorageDriver`，并 `TypeOrmModule.forFeature([FileEntity])` 或 `forRoot` 全局注册 repository。
- `forFeature()`：暴露 `FileService`/`FileRepository` 供消费模块注入。

### 3. knowledge 模块（apps/backend/src/knowledge）

**`KnowledgeBaseEntity`**（`@Entity('knowledge_bases')`）：

- `id`（uuid 主键）、`ownerId`（uuid，`@Index`）
- `visibility`：`@Column({ type:'varchar', default:'private' })`，`'private'|'public'`
- `name`、`description`（可选）
- `@CreateDateColumn`/`@UpdateDateColumn`
- 复合索引：`IDX_knowledge_bases_owner_visibility(['ownerId','visibility'])`

**`KnowledgeDocumentEntity`**（`@Entity('knowledge_documents')`）：

- `id`（uuid 主键）、`knowledgeBaseId`（uuid，FK→KB，`onDelete:'CASCADE'`）
- `fileId`（uuid，FK→files，`onDelete:'CASCADE'`）
- `title`（string）、`content`（text，解析出的纯文本）
- `@CreateDateColumn`/`@UpdateDateColumn`
- 索引：`IDX_knowledge_documents_kb_created(['knowledgeBaseId','createdAt'])`

**权限规则**（集中在 `KnowledgeService`）：单次查询 `from(sourceId)` + `assertOwner` / `assertReadable`。

- 读（GET）：明确某 KB 时——`ownerId===user.id` 或 `visibility==='public'` 放行；**public 且非属主 → 只读**，所有写接口先 `assertOwner`。
- 写（POST/PATCH/DELETE、上传文档）：断言 `assertOwner(kb, user)`，非属主一律 403。

### 4. 核心数据流（上传文档）

1. `POST /knowledge/:kbId/documents`（`multipart/form-data`，字段 `file`）→ `FileInterceptor('file')` 接原始 Buffer。
2. `KnowledgeService.addDocument(kbId, user, file)`：a. `assertOwner(kb)` 检查属主；b. `FileService.validate(file.buffer, file.originalname)`（魔数 + 白名单 + 大小上限）；c. `FileService.save({...})` 落原文件 + 元数据，得 `FileEntity`；d. 按 `ext` 用 `ContentExtractor`（封装 pdf-parse/mammoth/直接读）提取纯文本；e. 建 `KnowledgeDocument`（`kbId + fileId + content`），`title` 默认取原始文件名去扩展名，返回文档 DTO。
3. 若 2d 解析失败：回滚——删除刚保存的文件与元数据，抛业务异常（避免孤儿文件）。

**`ContentExtractor`**（知识库模块内部，封装三解析器）：

- `.txt`/`.md`：`buffer.toString('utf8')`
- `.pdf`：`pdf-parse(buffer)` → `.text`
- `.docx`：`mammoth.extractRawText({ buffer })` → `.value`
- 不同 jpg/png 上传由白名单 + 魔数前置拦截。

### 5. API 一览（全部 `@Public()` 逆行、挂 JWT guard）

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | `/knowledge` | 建知识库 | 登录 |
| GET | `/knowledge` | 分页（返回「自己的 + 公开的」，`?visibility=` + `?name=` 关键字过滤） | 登录 |
| GET | `/knowledge/:id` | 知识库详情 | 属主或公开 |
| PATCH | `/knowledge/:id` | 改名称/描述/可见性 | 仅属主 |
| DELETE | `/knowledge/:id` | 删知识库（级联删文档/文件） | 仅属主 |
| POST | `/knowledge/:kbId/documents` | 上传文档（multipart `file`） | 仅属主 |
| GET | `/knowledge/:kbId/documents` | 某库文档分页列表（`?keyword=` 匹配 title/content） | 属主或公开 |
| GET | `/knowledge/:kbId/documents/:id` | 文档详情（含 `content`） | 属主或公开 |
| DELETE | `/knowledge/:kbId/documents/:id` | 删文档（连带删文件） | 仅属主 |

响应统一走 `{code,message,data}` 信封；分页返回 `{ list, total, page, pageSize }`。

### 6. ErrorCode 扩展（packages/shared/src/index.ts）

新增：

```ts
KNOWLEDGE_NOT_FOUND: 40410,
KNOWLEDGE_FORBIDDEN: 40301,       // 只读库越权写 / 非属主
KNOWLEDGE_INVALID_FILE_TYPE: 41501,
KNOWLEDGE_FILE_TOO_LARGE: 41301,
KNOWLEDGE_FILE_PARSE_FAILED: 42201,
```

### 7. 依赖与迁移

- `apps/backend` 新增依赖：`@coool/file-nest`（workspace:*）。无需加 multer（platform-express 自带）、无需加 pdf-parse/mammoth（封装在 file-nest 内部）。如需 catalog 统一版本，把 `file-type`/`pdf-parse`/`mammoth` 加入根 `pnpm-workspace.yaml` catalog（仅 file-nest 引用时可不进 catalog）。
- 新增 1 条 TypeORM migration：`CreateKnowledgeTables`——`knowledge_bases` + `knowledge_documents` + `files` 三张表 + 索引 + FK。生成后人工审查 `up`/`down` 再执行。

### 8. 配置（backend `.env`）

`FILE_STORAGE`（`'local'`，预留 `'s3'`）、`FILE_MAX_SIZE`（默认 `10485760`）、`UPLOAD_DIR`（默认 `uploads`）。

### 9. 测试

- **file-nest 单测**（`src/*.test.ts`，vitest）：
  - `LocalStorageDriver`：写/读/删、目录自动创建、覆盖写。
  - `FileService`：`validate` 魔数（html 伪装 .txt 被拒）、大小上限、白名单非法类型拒绝；`save` 写 driver + 落元数据；`delete` 清理。
  - `FileModule`：`forRootAsync` 注入 driver、`forFeature` 暴露服务。
- **knowledge 单测**（mock 仓储/解析器，沿用现有手写 `vi.fn()` 风格）：
  - `assertOwner`/`assertReadable`：属主写放行、公开只读、非属主写 403。
  - `addDocument`：正常上传成功；非法类型/超大小抛错；解析失败时**回滚删除文件**（无孤儿）。
  - KB 与文档 CRUD：分页、可见性过滤、级联删除。
- 集成：migration 后 `apps/file-nest` 与 backend 各自 `test`；覆盖不强制（与目录现有门槛一致，file-nest 参照 redis 的 coverage 门槛）。

## 演进路线（后续，不在本期）

1. 文档 chunk 切片 + embedding 向量化 + 向量存储（pgvector / lancedb）。
2. Chat 对话时检索知识库片段注入上下文（含引用来源）。
3. 指定用户共享（共享关系表 `kb_user(role:view|edit)`）。
4. `S3StorageDriver`（对象存储）。
5. 前端知识库管理页 + 与 AI 对话集成。
