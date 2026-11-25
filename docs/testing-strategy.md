# 测试策略

目标是让测试规模随**行为**增长，而不是随源码文件数线性膨胀。新增代码前先在这里确认测试该写在哪一层、放在哪个目录。

## 目录约定（集中管理）

测试不再与源码混放，统一收进各应用/包的 `test/`：

| 位置 | 内容 |
| --- | --- |
| `apps/backend/test/unit/**/*.spec.ts` | 后端单元/集成测试（镜像 `src/` 结构） |
| `apps/backend/test/e2e/**/*.e2e-spec.ts` | 真实 HTTP 端到端 |
| `apps/backend/test/tooling/**/*.spec.ts` | 生成器/工具脚本测试（如 OpenAPI 契约） |
| `apps/backend/test/support/` | `setup.ts`、e2e 脚手架、DB 准备/体检、实体与 QueryBuilder 夹具 |
| `apps/frontend/test/unit/**/*.test.tsx` | 前端单元/组件/路由测试（镜像 `src/` 结构） |
| `apps/frontend/test/e2e/smoke.spec.ts` | Playwright 全路由冒烟 |
| `apps/frontend/test/support/` | `setup.ts`、QueryClient 包装器、渲染辅助、fixtures |
| `apps/desktop/test/**/*.test.ts` | 主进程静态服务与安全加固测试 |
| `packages/*/test/**/*.test.ts` | 各包的单元/集成测试 |

后端测试通过 `@/*`（→ `src/`）与 `@test/*`（→ `test/`）别名导入；前端同理，另有既有的 `@/*`。别名在 `tsconfig` 与 Vitest `resolve.alias` 两处保持一致，避免搬迁目录后出现一长串 `../../../src`。

## 分层职责

| 层次 | 负责 | 不负责 |
| --- | --- | --- |
| 单元测试 | 纯逻辑：校验、解析、状态机、乐观更新与回滚、错误映射、SSE 帧处理 | 框架装配、参数转交、渲染整页 |
| 集成测试 | 服务与仓储的协作、QueryBuilder 生成的 SQL 性质（必要时用 `Test.createTestingModule` / 真实 QueryClient） | HTTP 编解码、鉴权链路 |
| e2e（后端） | 真实 HTTP 入口：路由、参数提取、状态码、cookie、权限、转发到 service | 内部实现细节 |
| e2e（前端） | 全路由可打开、控制台无 error、关键锚点 | 交互细节 |
| 桌面端 | 静态服务/SPA fallback/路径越界/反代、CSP 与权限加固 | Electron 窗口生命周期 |

## 禁止清单

- **不测框架**：Nest 的模块装配、装饰器元数据、`Test.createTestingModule` 能否编译。
- **不测纯转发**：controller 把参数原样交给 service、hook 把参数原样交给 API 的 `toHaveBeenCalledWith` 断言。这类行为由 e2e 覆盖；controller 只保留自己承担的校验分支（例如上传缺少文件字段）。
- **不为覆盖率写测试**：阈值是回归护栏，不是「每行都要有 spec」的指标。
- **不重复覆盖基类契约**：`PageQueryDto` / `CursorQueryDto` 的边界只在其基类 spec 里钉住，子类 spec 只覆盖自己新增的字段。
- **不复制测试脚手架**：QueryClient 包装器、QueryBuilder 链式 mock、实体夹具一律复用 `test/support/` 的共享实现。
- **不测 antd 内部结构**：优先用 role/label/text/aria 查询；不要断言 `.ant-*` class 或内部 DOM 层级，升级 antd 时这些断言会成片误报。
- **不提交 `.only` / `.skip`**：Vitest 配置已设 `allowOnly: false`，巡检脚本也会拦截。

## 覆盖率门禁

- 全仓统一在 **80%** 以上：后端、前端、desktop、shared、redis、file-nest、react-view-state 的 `lines/functions/branches/statements` 全局地板均为 80。
- 核心域另设更高分区阈值，避免「删掉核心测试、靠胶水层撑住平均值」：
  - 后端：`src/auth` `src/ai` `src/common` `src/knowledge` `src/model-provider` `src/users` `src/password` `src/redis` `src/health`。
  - 前端：`src/api` `src/hooks` `src/stores` `src/components` `src/routes`。
- 仅纯转发的控制器（`app` / `knowledge` / `model-provider` / `users`）从后端覆盖率剔除；`ai` / `health` / `auth` 控制器承载真实逻辑，仍计入。
- SonarCloud 新增代码覆盖率 ≥ 80%，走各包 lcov；`sonar.coverage.exclusions` 与各 `vitest.config.ts` 的 exclude 必须保持同一口径。

本地与 CI 使用同一套门禁：

```bash
pnpm test:cov          # 全仓覆盖率（pre-push 与 CI 使用）
pnpm test:audit        # 零断言 / 纯委托 / .only / .skip 巡检
```

## 可复现性要求

- **单测不连外部服务**：`DenylistService` 用内存 Redis 替身，不再连真实 Redis、也不再删除 `auth:denylist:*` 全局键。
- **e2e 固定环境**：`vitest.e2e.config.ts` 显式钉住 `DB_*` / `REDIS_*` / `FILE_*` / `LOG_LEVEL` / 上传目录；`test:support/e2e-db-config.ts` 只允许本机 host 与 `*_test` 库名，避免 `.env` 把 `DROP DATABASE` 引到共享环境。
- **e2e 串行**：所有 spec 共用一个测试库，`fileParallelism: false`；每个 spec 用随机 suffix 隔离自己的数据并在 `afterAll` 清理。
- **直接跑 vitest 也能得到明确报错**：`test/support/require-e2e-db.ts` 作为 `setupFiles` 先做只读体检，提示先跑 `pnpm --filter @lucy/backend test:e2e`。

## 巡检

`pnpm test:audit` 扫描全部测试文件，报告四类问题：零断言、纯委托 controller 断言、`.only`、`.skip`/`.todo`；加 `--fail` 可在 CI/推送前作为硬性检查。它只做启发式判断，结论需要人工复核。若 controller spec 断言的是参数映射/转换（而非原样透传），在文件注释里写 `audit-allow: delegation-only` 并说明理由即可豁免。
