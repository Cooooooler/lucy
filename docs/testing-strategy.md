# 测试策略

目标是让测试规模随**行为**增长，而不是随源码文件数线性膨胀。新增代码前先在这里确认测试该写在哪一层。

## 分层职责

| 层次 | 位置 | 负责 | 不负责 |
| --- | --- | --- | --- |
| 单元测试 | `apps/*/src/**/*.spec.ts(x)`、`src/**/*.test.ts(x)` | 纯逻辑：校验、解析、状态机、乐观更新与回滚、错误映射、SSE 帧处理 | 框架装配、参数转交、渲染整页 |
| 集成测试 | 同上，必要时用 `Test.createTestingModule` / 真实 QueryClient | 服务与仓储的协作、QueryBuilder 生成的 SQL 性质 | HTTP 编解码、鉴权链路 |
| e2e | `apps/backend/test/**/*.e2e-spec.ts` | 真实 HTTP 入口：路由、参数提取、状态码、cookie、权限、转发到 service | 内部实现细节 |
| 前端冒烟 | `apps/frontend/e2e/smoke.spec.ts` | 全路由可打开、控制台无 error、关键锚点 | 交互细节 |

## 禁止清单

- **不测框架**：Nest 的模块装配、装饰器元数据、`Test.createTestingModule` 能否编译。
- **不测纯转发**：controller 把参数原样交给 service、hook 把参数原样交给 API 的 `toHaveBeenCalledWith` 断言。这类行为由 e2e 覆盖；controller 只保留自己承担的校验分支（例如上传缺少文件字段）。
- **不为覆盖率写测试**：阈值是回归护栏，不是「每行都要有 spec」的指标。
- **不重复覆盖基类契约**：`PageQueryDto` / `CursorQueryDto` 的边界只在其基类 spec 里钉住，子类 spec 只覆盖自己新增的字段。
- **不复制测试脚手架**：QueryClient 包装器、QueryBuilder 链式 mock、实体夹具一律复用共享实现（见下）。

## 共享测试支撑

后端 `apps/backend/src/test/`：

- `support/query-builder.ts`：`aliasStub(name)`（keyset 查询的主别名/列名元数据）与 `chainable(qb, methods)`（把链式方法接成返回自身）。
- `knowledge.fixtures.ts`、`model-provider.fixtures.ts`：实体工厂与模块专用 QueryBuilder stub。
- `setup.ts`：必需环境变量注入。

前端 `apps/frontend/src/test/`：

- `query.tsx`：`createTestQueryClient()`（关闭重试）与 `createQueryWrapper(client?)`（`renderHook` 的 wrapper）。
- `fixtures.ts`、`render-helpers.tsx`、`setup.ts`。

新增模块的测试应直接从这些文件导入，不要再各写一份。

## 覆盖率

- 后端 `apps/backend/vitest.config.ts`：全局 80%（lines/functions/branches/statements），作为地板； `src/auth` `src/ai` `src/common` `src/knowledge` `src/model-provider` `src/users` 另有更高的分域阈值。
- 前端 `apps/frontend/vitest.config.ts`：全局 60%；`src/api` `src/hooks` `src/stores` 另有分域阈值。
- SonarCloud 新增代码覆盖率 ≥ 80%（走 lcov，不受 vitest 分域阈值影响）。

分域阈值的目的：删掉某核心域的一整块测试时，胶水层的高覆盖无法再把平均值撑过门禁。取值略低于当前实测值，给合理重构留余量。改动测试时以「是否覆盖真实行为」为准，不要为了数字回补无意义断言。

## 巡检

`pnpm test:audit` 扫描全部测试文件，报告「零断言」与「纯委托 controller 断言」两类用例；加 `--fail` 可在 CI 中作为硬性检查。它只做启发式判断，结论需要人工复核，但能挡住明显的空壳测试。若 controller spec 断言的是参数映射/转换（而非原样透传），在文件注释里写 `audit-allow: delegation-only` 并说明理由即可豁免。
