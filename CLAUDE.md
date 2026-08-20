# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

pnpm + Turborepo monorepo（`pnpm-workspace.yaml` 声明 `apps/*` 和 `packages/*`），全仓统一为 ESM：

- `apps/backend` — NestJS 11（Express），TypeScript ESM（`type: module`，`nodenext`），Vitest 4（unplugin-swc 提供装饰器元数据），PostgreSQL + TypeORM + Redis（经 `@coool/redis-nest`，RedisBloom）
- `apps/frontend` — Vite + React 19 + TypeScript，TanStack Router/Query/Store，antd 6 + ProComponents，Tailwind CSS 4，Vitest + jsdom
- `packages/shared` — `@lucy/shared` 共享类型与常量，tsup 构建为纯 ESM（`dist/index.js` + `dist/index.d.ts`）
- `packages/redis` — `@coool/redis-nest` 自研 NestJS Redis 集成模块（ioredis：连接管理/序列化/DI/多数据源/统一异常/`RedisService.raw` 逃生舱），后端 `RedisModule` 消费它；README 与 VitePress 文档见 `packages/redis/docs/`

## 常用命令（根目录）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖（CI 用 `--frozen-lockfile`） |
| `pnpm dev` | Turbo 并行启动所有应用 |
| `pnpm dev:backend` / `pnpm dev:frontend` | 只启动某个应用（`--filter`） |
| `pnpm build` | Turbo 构建 |
| `pnpm lint` | Turbo 跑 lint |
| `pnpm test` | Turbo 跑测试（**turbo.json 中 test 依赖 build，会先构建**） |
| `pnpm typecheck` | Turbo 跑 typecheck（依赖 `^build`，先构建依赖包） |
| `pnpm typegen` | 从后端 Swagger spec 重新生成共享契约类型（先 `gen:openapi` 出 spec，再 openapi-typescript） |
| `pnpm format` | 根目录 prettier 全量格式化 |
| `pnpm clean` | `scripts/clean.mjs` 清理各工作区 `dist/.umi/.mfsu/.swc/coverage/node_modules` 及 `.tsbuildinfo` |
| `pnpm commit` | commitizen 交互式提交（遵循 Conventional Commits） |

按包执行：

```bash
pnpm --filter @lucy/backend test                              # 后端全部单测
pnpm --filter @lucy/backend test src/app.controller.spec.ts   # 单个测试文件
pnpm --filter @lucy/backend test:cov                          # 覆盖率（CI 用）
pnpm --filter @lucy/backend test:e2e                          # 后端 e2e（test/ 目录）
pnpm --filter @lucy/frontend test                             # 前端全部单测
pnpm --filter @lucy/frontend test src/stores/auth.test.ts     # 单个测试文件
pnpm --filter @lucy/shared build                              # 构建 shared（消费方验证前先构建）
pnpm --filter @lucy/backend db:migrate / db:revert / db:show  # 数据库迁移
```

**filter 名**：backend=`@lucy/backend`、shared=`@lucy/shared`、frontend=`@lucy/frontend`、redis=`@coool/redis-nest`。

## 关键约定与注意事项

- **提交规范**：Conventional Commits。husky `pre-commit` 先跑 `pnpm typegen` 重新生成共享契约类型并 stage，再跑 `lint-staged` + `pnpm typecheck` + `pnpm test`，`commit-msg` 跑 commitlint（header ≤120、subject ≤100、type 小写）。提交前务必保证测试通过，否则 commit 会失败。
- **全仓 ESM**：所有包 `"type": "module"`。后端 tsconfig 用 `module/moduleResolution: nodenext`，相对导入必须带 `.js` 后缀，`__dirname`/`__filename` 不存在，用 `import.meta.url` 派生（如 `src/db/data-source.ts`）。
- **不要改动生成文件**：`dist/`、`.turbo/`、前端 `src/routeTree.gen.ts`（TanStack Router 插件生成，已提交但勿手改）、`.tanstack/`、`packages/shared/src/generated/openapi.ts`（openapi-typescript 从后端 Swagger 生成，已提交但勿手改；改后端 DTO/实体后跑 `pnpm typegen` 重新生成）。
- **shared 是纯 ESM 包**：backend（nodenext）与 frontend（bundler）都解析 `exports.import`。改动 shared 源码后先 `pnpm --filter @lucy/shared build` 再跑消费方验证。
- 后端 lint 脚本自带 `--fix`（`eslint "{src,apps,libs,test,scripts}/**/*.ts" --fix`），前端 `pnpm lint` 同样带 `--fix`。
- Prettier 配置在根目录 `.prettierrc`（单引号、printWidth 80、尾部逗号 all、organize-imports + packagejson + tailwindcss 插件），由 lint-staged 在提交时执行。
- 设计规格与实现计划放在 `docs/superpowers/specs|plans/`（superpowers-zh 工作流产物，跨会话复用）。

## 架构

### apps/backend（NestJS）

标准模块化结构，入口 `src/main.ts`，端口 `process.env.PORT ?? 3000`。单测与源码同目录（`*.spec.ts`），e2e 在 `test/`（`vitest.e2e.config.ts`）。`AppModule` 装配：`ConfigModule`（全局）、`CommonModule`、TypeORM（`forRootAsync` 读 `DB_*`）、`PasswordModule`、`UsersModule`、`RedisModule.forRootAsync`（来自 `@coool/redis-nest`，`useFactory: redisModuleOptions` 读 `REDIS_*`）、`AuthModule`、`AiModule`（LangChain + Ollama）。

- **ESM 约定**：见上文「全仓 ESM」。
- **tsx 仅用于 CLI 脚本**（typeorm 迁移）；esbuild 不输出 `design:paramtypes`，Nest 应用本体与 vitest 需经 SWC（`unplugin-swc`）转换。
- **Auth**：JWT access（`JWT_EXPIRES_IN`，默认 15m）+ refresh（`REFRESH_TTL_SECONDS`）；`DenylistService` 用 RedisBloom（`BF.ADD`/`BF.EXISTS`）做登出/换发后的令牌撤销，含双布隆过滤器轮换。
- 公共装饰器：`@Public()`（跳过 JWT 守卫）、`@CurrentUser()`；`AllExceptionsFilter` 统一异常为 `{code,message,data}` 信封；`ApiResponseInterceptor` 包裹成功响应。

#### 数据库（PostgreSQL + TypeORM）

连接配置走 `@nestjs/config`，从 `apps/backend/.env`（已 gitignore，参考 `.env.example`）读取：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `5432` | 数据库地址/端口 |
| `DB_USER` / `DB_PASSWORD` | `postgres` / `postgres` | 账号密码 |
| `DB_NAME` | `lucy` | 库名 |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Redis 地址/端口 |
| `JWT_SECRET` | 无 | JWT 密钥（`openssl rand -hex 32` 生成） |
| `JWT_EXPIRES_IN` / `REFRESH_TTL_SECONDS` | `15m` / `604800` | access / refresh 有效期 |
| `BLOOM_ERROR_RATE` / `BLOOM_CAPACITY` / `BLOOM_ROTATION_SECONDS` | `0.01` / `1000000` / `900` | 布隆过滤器参数 |

- `TypeOrmModule.forRootAsync` 读取上述变量，`synchronize: false`（schema 变更只走迁移），`autoLoadEntities: true`。
- 迁移：`src/db/data-source.ts` 是 CLI 专用 DataSource（内置 `dotenv/config`），迁移文件放 `src/db/migrations/`。
- 新增迁移（脚本未内置，Windows cmd 下 `$npm_config_name` 无法展开）：
  - 手写骨架：`pnpm --filter @lucy/backend exec tsx ./node_modules/typeorm/cli.js migration:create src/db/migrations/Name`
  - 基于实体 diff 生成：`pnpm --filter @lucy/backend exec tsx ./node_modules/typeorm/cli.js migration:generate src/db/migrations/Name -d src/db/data-source.ts`
- 生成迁移后必须人工审查 `up`/`down` 再执行；生产环境禁止 `synchronize`。

#### Redis（Docker + RedisBloom）

Redis 集成逻辑已抽到 `packages/redis`（`@coool/redis-nest`），后端经 `RedisModule.forRootAsync` 消费，`DenylistService` 用其 `RedisService.raw` 暴露的 client 执行 `BF.*`（登出/换发后的令牌撤销，含双布隆过滤器轮换）。改动该包源码后先 `pnpm --filter @coool/redis-nest build` 再跑后端验证。

根目录 `docker-compose.yml` 起 `redis/redis-stack-server`（容器名 `lucy-redis`，加载 RedisBloom 模块），供 DenylistService 做令牌撤销/设备去重。

- 连接：`127.0.0.1:6379`，仅绑定本机、无密码（如需密码在 compose 中加 `requirepass`）。
- 持久化：命名卷 `redis-data` + AOF（`--appendonly yes`），`restart: unless-stopped`。
- 常用命令：`docker compose up -d`、`docker compose ps`、`docker compose logs -f redis`、`docker compose down`。

### apps/frontend（Vite + React）

Vite + React 19 + TS（strict），Tailwind 4。构建脚本 `tsc -b && vite build`（`tsconfig.json` 引用 `tsconfig.app.json` + `tsconfig.node.json`）。dev server 将 `/api` 代理到 `http://localhost:3000`（后端，`/api` 前缀在代理处 rewrite 去除），前端 dev 请求 baseURL 为 `/api/`。

- **路由**：TanStack Router 文件式路由（`src/routes/`，`_auth/login|register`、`_layout/about|index`）；`src/routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动生成，勿手改。
- **状态/请求**：TanStack Store（`src/stores/auth.ts`）+ TanStack Query（`src/queryClient.ts`）；antd 6 + `@ant-design/pro-components` + ahooks。
- **别名**（tsconfig paths + vite-tsconfig-paths）：`@`→`src/`、`@api`→`src/api/`、`@bg`→`src/backgrounds/index.ts`、`@components`→`src/components/index.ts`。
- **目录**：`src/api`（ky HTTP 客户端）、`src/auth`（AuthProvider）、`src/backgrounds`（视觉特效）、`src/components`、`src/routes`、`src/stores`、`src/test`（fixtures + setup）。
- **测试**：Vitest + jsdom + Testing Library，覆盖率门槛 80%（`vitest.config.ts` 排除视觉特效、路由、生成代码等非业务模块）。

### packages/shared（@lucy/shared）

前后端共享的基础设施类型与常量：`ApiResponse`、`ErrorCode`/`ErrorCodeValue`、`PageQuery`、`PageResult`。接口契约类型（`User`/`AuthTokens`/`LoginResult` 等）由后端 Swagger spec 经 openapi-typescript 生成到 `src/generated/openapi.ts`（已提交、勿手改），通过 `components['schemas']['xxx']` 消费；改后端 DTO/实体后跑 `pnpm typegen`（内部先 `gen:openapi` 产出 `openapi.json` 再生成类型，`openapi.json` 已 gitignore）。tsup 构建纯 ESM（`--format esm --clean`），`exports.import` → `dist/index.js`。改动后重建并跑消费方（backend typecheck/test、frontend build/test）验证。

### packages/redis（@coool/redis-nest）

自研 NestJS Redis 集成模块，基于 `ioredis`：连接管理（`forRoot`/`forRootAsync` 支持 standalone/sentinel/cluster）、统一 DI（`RedisService`，`global: true`）、统一异常（ioredis 错误包装为 `RedisException` 带稳定错误码）、序列化（默认 JSON，`setJson`/`getJson`）、多数据源（`forFeature` 命名客户端 + key 前缀命名空间）、`hashTag`/`pipeline` 工具，及 `RedisService.raw` 逃生舱（暴露底层 client 供 `BF.*`/`eval`）。tsup 构建双格式（`esm` + `cjs`，`dist/index.js` + `dist/index.cjs`），`@nestjs/common`/`@nestjs/core`/`ioredis` 为 peer/dev 依赖。完整文档见 `packages/redis/README.md` 与 `packages/redis/docs/`（VitePress，`pnpm docs:dev` 预览），含真实 Redis 集成测试。改动后先 build 再跑后端验证。

### 数据流

前端 `src/api/` 基于 `ky`：`publicHttp`（登录/注册/刷新）与 `http`（附加 Bearer，401 时单飞刷新并带新 token 重试一次）两个实例；统一解包 `{code,message,data}` 信封，非 0 / 非 2xx 抛 `ApiError`。`src/api/types.ts` 将生成的 `components['schemas']` 导出为易用别名（`LoginRequest`/`LoginResult`/`User` 等）。dev 环境经 Vite proxy 到后端；新增接口时改后端 DTO/实体、跑 `pnpm typegen`，再在 `src/api/` 加客户端函数。

## Superpowers-ZH 中文增强版

本项目已安装 superpowers-zh 技能框架。核心规则：收到任务先检查是否有匹配 skill（哪怕 1% 可能性）、设计先于编码（brainstorming）、测试先于实现（TDD）、验证先于完成。技能清单与用法见用户级全局 CLAUDE.md，项目侧只存放规格/计划产物（`docs/superpowers/`）。

## MCP 工具

项目接入多套 MCP：**Codegraph**（代码理解，最高优先级）、**WebStorm**（IDE 能力，优先执行类操作）、**SonarQube**（代码质量）、**antd**（组件库 API）。按任务类型选用，详见各节。

### Codegraph MCP（代码理解，最高优先级）

仓库根有 `.codegraph/` 索引，提供符号查找、引用分析、调用链查询、结构浏览等能力。处理任何代码理解/搜索/重构/分析任务时，按以下优先级使用工具：

1. **Codegraph MCP（最高优先级）**：默认先调 `codegraph_explore`——可传自然语言问题或符号/文件名，一次返回相关符号的逐行源码、调用路径与影响面（blast radius）。优先于 grep + 读文件。
2. **直接文件系统读取（回退）**：仅当满足以下任一条件时使用 `Read`/`Glob`/`Grep`：
   - Codegraph 结果明显过期（如代码刚修改、索引未更新）；
   - Codegraph 未覆盖配置文件、非代码文本、生成文件等；
   - Codegraph 调用失败/超时且重试后仍不可用；
   - 需要文件的确切原始内容（完整拷贝、检查空白/注释）。
3. **其他 MCP 工具**：代码理解类任务仍优先 Codegraph。

### WebStorm MCP（IDE 能力，优先执行类操作）

WebStorm IDE 已接入 MCP。当 WebStorm 可用时，**执行类操作优先走 WebStorm 工具**而非 Bash/文件系统直接操作——利用 IDE 的索引、重构引擎与真实终端。判断可用性：`get_repositories` 或 `get_all_open_file_paths` 能否返回本项目；不可用则回退到 Bash/Read/Write。

常用工具：

- **定位/导航**：`search_symbol`、`search_file`、`search_regex`、`search_text`、`get_symbol_info`、`analyze_calls`、`open_file_in_editor`、`get_all_open_file_paths` — 查代码与跳转
- **构建/运行**：`build_project`、`execute_run_configuration`、`get_run_configurations`、`get_project_modules`、`get_project_dependencies` — 构建、跑配置、看模块/依赖
- **质量**：`lint_files`、`get_file_problems`、`reformat_file`、`execute_tool` — 即时检查与格式化
- **重构**：`rename_refactoring` — 使用 IDE 重构引擎（比手改更安全，自动更新引用）
- **Git**：`git_status`、`get_repositories` — 仓库状态
- **文件**：`read_file`、`create_new_file`、`apply_patch` — 读写/补丁（注意：读写正文仍以本机 Read/Write 为准，WebStorm 用于 IDE 同步/补丁）
- **数据库**：`list_database_connections`、`list_database_schemas`、`list_schema_objects`、`introspect_schema`、`execute_sql_query`、`fetch_query_result`、`preview_table_data`、`test_database_connection`、`create_database_connection`、`edit_database_connection` — 数据库导航与查询
- **终端**：`execute_terminal_command` — 在 IDE 内执行命令

优先级与注意：

- **执行类任务（构建、运行、lint、重构、数据库查询、终端命令）优先用 WebStorm**，能拿到 IDE 索引/引擎的结果；但生成文件、`dist/`、构建产物等仍以实际命令验证为准。
- **纯代码理解仍优先 Codegraph**（`codegraph_explore`）；WebStorm 侧重 IDE 状态与执行。
- **代码编辑正文**仍用本机 `Edit`/`Write`（保证逐字准确），WebStorm 的 `apply_patch` 用于需要 IDE 同步的场景。
- 涉及数据库操作（尤其写操作）前先确认连接与目标 schema，避免误写生产数据。

### SonarQube MCP（代码质量分析）

处理 SonarCloud/SonarQube 相关任务时使用——质量门禁、issues/漏洞/安全热点、覆盖率缺口、重复代码。项目 key 已固化在 `sonar-project.properties`：**`Cooooooler_lucy`**（org `cooooooler`）。

常用工具：

- `get_component_measures`（ncloc/complexity/violations/coverage）、`search_sonar_issues_in_projects` — 查指标与问题
- `get_project_quality_gate_status` — 质量门禁状态（提交/合并前确认未引入新问题）
- `get_file_coverage_details`、`search_files_by_coverage` — 覆盖率缺口
- `get_duplications`、`search_duplicated_files` — 重复代码
- `show_rule`、`analyze_code_snippet` — 规则详情 / 代码片段分析
- `search_security_hotspots`、`show_security_hotspot`、`change_security_hotspot_status` — 安全热点
- `change_sonar_issue_status` — 处置 issue
- `search_my_sonarqube_projects`、`search_metrics`、`list_branches`、`list_pull_requests` — 定位项目/指标/分支

关键注意：

- **分支 vs PR 上下文**：长/短命分支分析用 `branch`（可用 `list_branches` 发现，git 分支名也可用）；PR 分析用 `pullRequest`（key 来自 `list_pull_requests`，**绝不能传 git 分支名**）。两者不可同时传；都省略则查 main 分支。
- **项目 key 解析**：直接使用 `Cooooooler_lucy`，无需搜索；不确定时再用 `search_my_sonarqube_projects`。
- 修改代码后、提交/合并前，可先查质量门禁与新增 issue，避免引入回归。

### antd MCP（Ant Design 官方 API 查询）

前端使用 antd 6.5.3 + `@ant-design/pro-components`。编写/调试 antd 组件、查询组件 API/props/设计 token/示例代码、版本升级时使用。

常用工具：

- `antd_info`（组件 API：props/类型/默认值）、`antd_doc`（完整文档）、`antd_demo`（示例源码）— 使用组件时查 API 与用法
- `antd_token`（全局或组件级设计 token）、`antd_semantic`（classNames/styles 语义化定制结构）— 样式定制/主题
- `antd_changelog`（版本变更、两版本间 API diff）— 升级或排查破坏性变更
- `antd_design_md`（v6 设计语言文档）— 整体设计语言参考

说明：项目当前为 antd v6，设计语言文档仅 v6 发布；如需版本间 API 差异用 `antd_changelog` 的 v1/v2 diff 模式。写 antd 代码时可同时参考 antd skill 与官方 MCP 查询。
