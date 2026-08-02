# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

pnpm + Turborepo monorepo（`pnpm-workspace.yaml` 声明 `apps/*` 和 `packages/*`）：

- `apps/backend` — NestJS 11（Express），TypeScript，Jest 30 + ts-jest
- `apps/frontend` — Umi Max 4（`@umijs/max`），React 18，antd 5 + ProComponents，含 mock
- `packages/shared` — 共享代码包 `@lucy/shared`（当前仅 package.json 占位，`main` 指向尚未创建的 `src/index.ts`）

## 常用命令（根目录）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖（frontend 的 postinstall 会自动执行 `max setup`） |
| `pnpm dev` | Turbo 并行启动所有应用 |
| `pnpm dev:backend` / `pnpm dev:frontend` | 只启动某个应用（`--filter`） |
| `pnpm build` | Turbo 构建 |
| `pnpm lint` | Turbo 跑 lint |
| `pnpm test` | Turbo 跑测试（**turbo.json 中 test 依赖 build，会先构建**） |
| `pnpm format` | 根目录 prettier 全量格式化 |
| `pnpm clean` | `scripts/clean.mjs` 清理 dist/.umi/.umi-production/.mfsu/.swc/coverage |
| `pnpm commit` | commitizen 交互式提交（遵循 Conventional Commits） |

按包执行：

```bash
pnpm --filter @lucy/backend test                 # 后端全部单测
pnpm --filter @lucy/backend test -- --runInBand src/app.controller.spec.ts   # 单个测试文件
pnpm --filter @lucy/backend test:e2e             # 后端 e2e（test/ 目录）
pnpm --filter @lucy/frontend lint                # 前端 lint
pnpm --filter @lucy/backend db:migrate           # 执行数据库迁移
pnpm --filter @lucy/backend db:revert            # 回滚最近一次迁移
pnpm --filter @lucy/backend db:show              # 查看迁移执行状态
```

## 关键约定与注意事项

- **提交规范**：Conventional Commits。husky `pre-commit` 跑 `lint-staged` + `pnpm test`，`commit-msg` 跑 commitlint（header ≤120、subject ≤100、type 小写）。提交前务必保证测试通过，否则 commit 会失败。
- **不要改动生成目录**：`src/.umi/`、`src/.umi-production/`、`dist/`、`.turbo/`。前端 `tsconfig.json` extends `src/.umi/tsconfig.json`（由 `max setup` 生成）。
- 后端 lint 脚本自带 `--fix`（`eslint "{src,apps,libs,test}/**/*.ts" --fix`）。
- Prettier 配置在根目录 `.prettierrc`（单引号、printWidth 80、尾部逗号 all、含 organize-imports 和 packagejson 插件），由 lint-staged 在提交时执行。
- 前端无 `.umirc.ts`，依赖 Umi Max 约定式路由：`src/pages/` 下新增目录即新增路由。
- 前端 `@` 别名指向 `src/`。

## 架构

### apps/backend（NestJS）

标准 NestJS 模块化结构：`AppModule` → `AppController` + `AppService`。入口 `src/main.ts`，端口 `process.env.PORT ?? 3000`。单测文件与源码同目录（`*.spec.ts`），e2e 在 `test/`。

#### 数据库（PostgreSQL + TypeORM）

连接配置走 `@nestjs/config`，从 `apps/backend/.env`（已被 gitignore，参考 `.env.example`）读取：

| 变量                      | 默认值      | 说明       |
| ------------------------- | ----------- | ---------- |
| `DB_HOST`                 | `127.0.0.1` | 数据库地址 |
| `DB_PORT`                 | `5432`      | 端口       |
| `DB_USER` / `DB_PASSWORD` | `postgres`  | 账号密码   |
| `DB_NAME`                 | `lucy`      | 库名       |

- `AppModule` 中 `TypeOrmModule.forRootAsync` 读取上述变量，`synchronize: false`（schema 变更只走迁移），`autoLoadEntities: true`。
- 迁移：`src/db/data-source.ts` 是 CLI 专用 DataSource（内置 `dotenv/config`），迁移文件放 `src/db/migrations/`。`db:migrate` 等脚本见「按包执行」。
- 新增迁移文件（脚本未内置，Windows cmd 下 `$npm_config_name` 无法展开）：
  - 手写骨架：`pnpm --filter @lucy/backend exec typeorm-ts-node-commonjs migration:create src/db/migrations/Name`
  - 基于实体 diff 生成：`pnpm --filter @lucy/backend exec typeorm-ts-node-commonjs migration:generate src/db/migrations/Name -d src/db/data-source.ts`
- 生成迁移后必须人工审查 `up`/`down` 再执行；生产环境禁止 `synchronize`。

### apps/frontend（Umi Max）

约定式目录，`@umijs/max` 会按目录自动装配插件（antd、layout、access、model、request、initialState）：

- `src/pages/` — 文件路由（Home、Table CRUD 示例、Access 权限示例）
- `src/models/` — `useModel` 全局共享状态（如 `global.ts`）
- `src/services/` — API 客户端 + 类型定义（`demo/UserController.ts` + `typings.d.ts`）
- `src/access.ts` — 权限定义（`canSeeAdmin`），基于 `app.ts` 的 `getInitialState`
- `src/app.ts` — 运行时配置（`layout`、`getInitialState`）
- `mock/` — 本地 mock 数据（`userAPI.ts`），dev 环境生效

### 数据流约定

前端页面通过 `@/services` 调用 API，dev 环境由 `mock/` 拦截返回；后端提供真实接口后，前端服务层直接对接。新增接口时同步维护 `services/**/typings.d.ts` 中的类型。

## Superpowers-ZH 中文增强版

本项目已安装 superpowers-zh 技能框架（20 个 skills）。

## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 `.claude/skills/` 目录，每个 skill 有独立的 `SKILL.md` 文件。

- **brainstorming**: 在任何创造性工作之前必须使用此技能——创建功能、构建组件、添加功能或修改行为。在实现之前先探索用户意图、需求和设计。
- **chinese-code-review**: 中文 review 沟通参考——话术模板、分级标注（必须修复/建议修改/仅供参考）、国内团队常见反模式应对。仅在用户显式 /chinese-code-review 时调用，不要根据上下文自动触发。
- **chinese-commit-conventions**: 中文 commit 与 changelog 配置参考——Conventional Commits 中文适配、commitlint/husky/commitizen 中文模板、conventional-changelog 中文配置。仅在用户显式 /chinese-commit-conventions 时调用，不要根据上下文自动触发。
- **chinese-documentation**: 中文文档排版参考——中英文空格、全半角标点、术语保留、链接格式、中文文案排版指北约定。仅在用户显式 /chinese-documentation 时调用，不要根据上下文自动触发。
- **chinese-git-workflow**: 国内 Git 平台配置参考——Gitee、Coding.net、极狐 GitLab、CNB 的 SSH/HTTPS/凭据/CI 接入差异与镜像同步配置。仅在用户显式 /chinese-git-workflow 时调用，不要根据上下文自动触发。
- **dispatching-parallel-agents**: 当面对 2 个以上可以独立进行、无共享状态或顺序依赖的任务时使用
- **executing-plans**: 当你有一份书面实现计划需要在单独的会话中执行，并设有审查检查点时使用
- **finishing-a-development-branch**: 当实现完成、所有测试通过、需要决定如何集成工作时使用——通过提供合并、PR或清理等结构化选项来引导开发工作的收尾
- **mcp-builder**: MCP 服务器构建方法论 — 系统化构建生产级 MCP 工具，让 AI 助手连接外部能力
- **receiving-code-review**: 收到代码审查反馈后、实施建议之前使用，尤其当反馈不明确或技术上有疑问时——需要技术严谨性和验证，而非敷衍附和或盲目执行
- **requesting-code-review**: 完成任务、实现重要功能或合并前使用，用于验证工作成果是否符合要求
- **subagent-driven-development**: 当在当前会话中执行包含独立任务的实现计划时使用
- **systematic-debugging**: 遇到任何 bug、测试失败或异常行为时使用，在提出修复方案之前执行
- **test-driven-development**: 在实现任何功能或修复 bug 时使用，在编写实现代码之前
- **using-git-worktrees**: 当需要开始与当前工作区隔离的功能开发，或在执行实现计划之前使用——通过原生工具或 git worktree回退机制确保隔离工作区存在
- **using-superpowers**: 在开始任何对话时使用——确立如何查找和使用技能，要求在任何响应（包括澄清性问题）之前调用 Skill 工具
- **verification-before-completion**: 在宣称工作完成、已测试通过之前使用，在提交或创建 PR之前——必须运行验证命令并确认输出后才能声称成功；始终用证据支撑断言
- **workflow-runner**: 在 Claude Code / OpenClaw / Cursor 中直接运行 agency-orchestrator YAML 工作流——无需 API key，使用当前会话的 LLM 作为执行引擎。当用户提供 .yaml 工作流文件或要求多角色协作完成任务时触发。
- **writing-plans**: 当你有规格说明或需求用于多步骤任务时使用，在动手写代码之前
- **writing-skills**: 当创建新技能、编辑现有技能或在部署前验证技能是否有效时使用

## 如何使用

当任务匹配某个 skill 时，使用 `Skill` 工具加载对应 skill 并严格遵循其流程。绝不要用 Read 工具读取 SKILL.md 文件。

如果你认为哪怕只有 1% 的可能性某个 skill 适用于你正在做的事情，你必须调用该 skill 检查。

<!-- superpowers-zh:end -->

## 核心原则：代码智能优先使用 Codegraph MCP

本项目已接入 **Codegraph MCP**，它能够通过预先构建的代码索引，高效提供符号查找、引用分析、调用链查询、结构浏览等能力。  
**在处理任何与代码理解、搜索、重构或分析相关的任务时，必须严格遵循以下优先级。**

---

# 工具使用优先级

1. **Codegraph MCP 工具（最高优先级）**  
   用于：搜索符号、查找定义/引用、分析调用关系、浏览代码结构、获取类型信息、跨文件导航等。  
   _你在选择工具时，应默认使用 Codegraph 提供的函数，除非满足下方“回退条件”。_

2. **直接文件系统读取（低优先级）**  
   仅当以下 **任一条件**满足时，才可使用 `Read`/`View` 等文件工具读取原始文件：

- Codegraph 工具返回的结果明显过期（例如，用户明确指出代码刚刚修改但索引未更新）。
- Codegraph 未覆盖所需文件（例如索引范围外的配置文件、非代码文本文件、生成文件等）。
- Codegraph 工具调用失败、超时或返回错误，且重试后依然不可用。
- 你需要获取 **文件的确切原始内容**（如完整拷贝一段代码、检查空白符/注释等）而 Codegraph 抽象后的表示可能不完整。

3. **其他 MCP 工具**（如有）  
   如果存在其他代码分析工具（如 linter、测试运行器），请根据任务性质自然选择，但 **代码理解类任务仍应优先走 Codegraph**。

---

## Codegraph 常用工具速查（示意）

_以下工具名称以你实际接入的 Codegraph MCP 提供为准，请在实际使用时查询工具列表并匹配。_

- `search_symbol` / `get_symbol` — 查找函数、类、变量定义及其文档。
- `find_references` — 查找某个符号的所有引用位置。
- `call_hierarchy` / `incoming_calls` / `outgoing_calls` — 分析调用链。
- `browse_structure` — 获取目录或文件的符号大纲。
- `search_code` — 全文或正则搜索代码片段。
- `type_info` — 查询变量或表达式的类型。

_每次执行任务前，先思考哪些 Codegraph 工具能最高效地完成目标，然后调用它们。_
