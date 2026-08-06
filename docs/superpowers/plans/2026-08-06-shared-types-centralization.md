# 共享类型下沉 + @lucy/shared 可构建化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把前后端各自维护的认证类型（`User`/`AuthTokens`/`LoginResult`）下沉到 `@lucy/shared` 统一消费，并把 shared 改造成双格式（CJS+ESM）可构建包，消除裸 TS 隐患。

**架构：** shared 用 tsup 构建 `dist/`（CJS 的 `index.js` + ESM 的 `index.mjs`，含 `.d.ts`/`.d.mts`），`exports` map 分 `require`/`import` 条件；后端（CommonJS）走 CJS 分支，前端（Vite/ESM）走 ESM 分支；删除前端 `api/types.ts` 与后端 `SafeUser`，统一使用 shared 的 `User`/`AuthTokens`/`LoginResult`。

**技术栈：** tsup、TypeScript、Turbo、NestJS、Vite

参考规格：`docs/superpowers/specs/2026-08-06-shared-types-centralization-design.md`

---

## 文件结构

**修改：**

- `packages/shared/package.json` — 加 `build`/`dev` 脚本、`exports` map、`main`/`types` 指向 dist、devDependency `tsup`
- `packages/shared/src/index.ts` — 新增 `User`/`AuthTokens`/`LoginResult` 三个接口
- `turbo.json` — `dev` 与 `typecheck` 任务加 `dependsOn: ["^build"]`
- `apps/backend/src/auth/auth.service.ts` — 删除本地 `SafeUser`，改用 shared 类型
- `apps/backend/src/auth/auth.controller.ts` — `SafeUser` 类型引用改 shared `User`
- `apps/backend/src/auth/auth.controller.spec.ts` — 测试描述文案更新（`SafeUser` → `User`）
- `apps/frontend/package.json` — 加依赖 `@lucy/shared: workspace:*`
- `apps/frontend/src/stores/auth.ts` — 删除本地 `User`，改从 shared 导入
- `apps/frontend/src/api/auth.ts` — 类型改从 shared 导入
- `apps/frontend/src/api/client.ts` — `ApiEnvelope` 改 shared `ApiResponse`，`AuthTokens` 从 shared 导入

**删除：**

- `apps/frontend/src/api/types.ts`

**不改：**

- 后端模块格式（保持 CommonJS）；`.gitignore`（已有 `dist` 规则）；shared `tsconfig.json`（typecheck 用）

---

### 任务 1：shared 包构建化（tsup 双格式）

**文件：**

- 修改：`packages/shared/package.json`
- 修改：`turbo.json`

- [ ] **步骤 1：安装 tsup**

运行：`pnpm --filter @lucy/shared add -D tsup` 预期：`packages/shared/package.json` 的 `devDependencies` 出现 `tsup`，`pnpm-lock.yaml` 更新。

- [ ] **步骤 2：改写 `packages/shared/package.json`**

`main`/`types` 从 `./src/index.ts` 改为指向 dist；新增 `build`/`dev` 脚本与 `exports` map（注意：**不添加** `"type": "module"`，保持 CJS 默认，tsup 据此产出 `index.js`=CJS、`index.mjs`=ESM）：

```json
{
  "name": "@lucy/shared",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "lint": "eslint \"src/**/*.ts\" --fix",
    "typecheck": "tsc --noEmit"
  }
}
```

（`devDependencies` 里的 `tsup` 由步骤 1 写入，保留不动。）

- [ ] **步骤 3：更新 `turbo.json` 的 `dev` 与 `typecheck`**

`dev` 与 `typecheck` 任务加 `dependsOn: ["^build"]`，确保消费者（backend/frontend）在解析 shared 的 dist 前它已被构建：

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **步骤 4：构建并验证 dist 产物**

运行：`pnpm --filter @lucy/shared build` 预期：`packages/shared/dist/` 下产出 `index.js`、`index.mjs`、`index.d.ts`、`index.d.mts` 四个文件。

验证 CJS/ESM 双分支可加载：

- `node -e "const s = require('./packages/shared/dist/index.js'); console.log(s.ErrorCode.OK)"` → 打印 `0`
- `node --input-type=module -e "import { ErrorCode } from './packages/shared/dist/index.mjs'; console.log(ErrorCode.OK)"` → 打印 `0`

> 若 `tsup --dts` 因 shared `tsconfig.json` 的 `noEmit: true` 报错：为 shared 新增 `tsconfig.build.json`（`extends ./tsconfig.json`，将 `noEmit` 置 `false`），并在两个脚本后追加 `--tsconfig tsconfig.build.json`。

- [ ] **步骤 5：确认后端现有对 shared 的引用未回归**

运行：`pnpm --filter @lucy/backend test` 预期：11 个测试套件、47 个测试全部通过（证明 `ErrorCode` 经新 exports 仍可解析）。

- [ ] **步骤 6：Commit**

```bash
git add packages/shared/package.json pnpm-lock.yaml turbo.json
git commit -m "build(shared): tsup 双格式构建并暴露 exports map，turbo 任务前置依赖 shared build"
```

---

### 任务 2：shared 新增共享类型

**文件：**

- 修改：`packages/shared/src/index.ts`

- [ ] **步骤 1：在 `src/index.ts` 末尾追加三个接口**

现有 `ApiResponse`/`ErrorCode`/`PageQuery`/`PageResult` 保留不动，追加：

```ts
/** 用户公开信息（无 passwordHash 等敏感字段），前后端共享 */
export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 令牌对：accessToken + refreshToken */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** 登录/刷新成功返回 */
export interface LoginResult extends AuthTokens {
  user: User;
}
```

- [ ] **步骤 2：typecheck + 构建验证**

运行：`pnpm --filter @lucy/shared typecheck && pnpm --filter @lucy/shared build` 预期：均成功，无报错。

- [ ] **步骤 3：Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): 新增 User/AuthTokens/LoginResult 共享类型"
```

---

### 任务 3：后端消费 shared

**文件：**

- 修改：`apps/backend/src/auth/auth.service.ts`
- 修改：`apps/backend/src/auth/auth.controller.ts`
- 修改：`apps/backend/src/auth/auth.controller.spec.ts:43`

- [ ] **步骤 1：`auth.service.ts` 引入 shared 类型并删除 `SafeUser`**

在第 1 行 `import { ErrorCode } from '@lucy/shared';` 后追加（`User` 与实体 `User` 冲突，需别名）：

```ts
import type { AuthTokens, LoginResult, User as SharedUser } from '@lucy/shared';
```

删除第 13-21 行的 `export interface SafeUser {...}` 定义。

签名逐一替换（`SafeUser` → `SharedUser`，内联令牌类型 → `AuthTokens`/`LoginResult`）：

| 行 | 原 | 新 |
| --- | --- | --- |
| 42 | `private toSafeUser(user: User): SafeUser {` | `private toSafeUser(user: User): SharedUser {` |
| 53 | `}): Promise<SafeUser> {` | `}): Promise<SharedUser> {` |
| 61 | `}): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {` | `}): Promise<LoginResult> {` |
| 96 | `): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {` | `): Promise<LoginResult> {` |
| 110 | `async refresh(refreshToken: string): Promise<{\n    accessToken: string;\n    refreshToken: string;\n  }> {` | `async refresh(refreshToken: string): Promise<AuthTokens> {` |
| 151 | `async me(userId: string): Promise<SafeUser> {` | `async me(userId: string): Promise<SharedUser> {` |

`toSafeUser` 方法体不变（实体 `createdAt`/`updatedAt` 为 `Date`，与 shared `User` 一致）。

- [ ] **步骤 2：`auth.controller.ts` 改用 shared `User`**

第 6 行 `import type { SafeUser } from './auth.service';` 改为：

```ts
import type { User } from '@lucy/shared';
```

第 20 行 `register(...): Promise<SafeUser> {` → `Promise<User> {` 第 67 行 `me(...): Promise<SafeUser> {` → `Promise<User> {`

- [ ] **步骤 3：`auth.controller.spec.ts` 更新测试描述**

第 43 行 `it('register 委托 authService.register 并返回 SafeUser', ...)` → `it('register 委托 authService.register 并返回 User', ...)`。（spec 中的 `safeUser` 对象字面量本就含 `createdAt`/`updatedAt`，形状与 shared `User` 一致，无需其它改动。）

- [ ] **步骤 4：typecheck + 测试验证**

运行：`pnpm --filter @lucy/backend typecheck` 预期：通过，无 `SafeUser` 残留。

运行：`pnpm --filter @lucy/backend test` 预期：11 套件 / 47 测试全过。

验证无残留：`grep -rn "SafeUser" apps/backend/src` → 无输出。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.controller.ts apps/backend/src/auth/auth.controller.spec.ts
git commit -m "refactor(backend): auth 类型改从 @lucy/shared 消费，删除本地 SafeUser"
```

---

### 任务 4：前端消费 shared

**文件：**

- 修改：`apps/frontend/package.json`
- 修改：`apps/frontend/src/stores/auth.ts`
- 修改：`apps/frontend/src/api/auth.ts`
- 修改：`apps/frontend/src/api/client.ts`
- 删除：`apps/frontend/src/api/types.ts`

- [ ] **步骤 1：添加 workspace 依赖**

运行：`pnpm --filter frontend add @lucy/shared@workspace:*` 预期：`apps/frontend/package.json` 的 `dependencies` 出现 `"@lucy/shared": "workspace:*"`（位于 `@ant-design/*` 与 `@tanstack/*` 之间），`pnpm-lock.yaml` 更新。

- [ ] **步骤 2：`stores/auth.ts` 删除本地 `User`，改从 shared 导入**

删除第 3-9 行的 `export interface User {...}` 定义，并在顶部（`import { createStore } from '@tanstack/store';` 之后）追加：

```ts
import type { User } from '@lucy/shared';
```

`AuthState`/`PersistedSession`/`login()` 对 `User` 的引用不变。

- [ ] **步骤 3：`api/auth.ts` 类型改从 shared 导入**

第 1 行 `import type { User } from '../stores/auth';` 与第 3 行 `import type { LoginResult } from './types';` 合并为一行：

```ts
import type { LoginResult, User } from '@lucy/shared';
```

- [ ] **步骤 4：`api/client.ts` 用 shared `ApiResponse`/`AuthTokens`**

第 3 行 `import type { AuthTokens } from './types';` 改为：

```ts
import type { ApiResponse, AuthTokens } from '@lucy/shared';
```

删除第 17-21 行的本地 `interface ApiEnvelope<T> {...}`。

第 28 行 `}) as ApiEnvelope<unknown> | null;` → `}) as ApiResponse<unknown> | null;`

- [ ] **步骤 5：删除 `apps/frontend/src/api/types.ts`**

运行：`rm apps/frontend/src/api/types.ts`

- [ ] **步骤 6：前端构建验证（含 tsc 类型检查）**

运行：`pnpm --filter frontend build` 预期：`tsc -b` 与 `vite build` 均成功，dist 产出正常。若报 `Cannot find module '@lucy/shared'`，先确认 `pnpm --filter @lucy/shared build` 已产出 dist。

- [ ] **步骤 7：Commit**

```bash
git add apps/frontend/package.json pnpm-lock.yaml apps/frontend/src/stores/auth.ts apps/frontend/src/api/auth.ts apps/frontend/src/api/client.ts
git rm apps/frontend/src/api/types.ts
git commit -m "refactor(frontend): auth 类型与响应信封改从 @lucy/shared 消费"
```

---

### 任务 5：全量验证

**文件：** 无（仅验证）

- [ ] **步骤 1：根 typecheck**

运行：`pnpm typecheck` 预期：backend / shared / frontend（经 build）全部通过。

- [ ] **步骤 2：根测试**

运行：`pnpm test` 预期：turbo 先构建后跑测试，后端 11 套件 / 47 测试全过。

- [ ] **步骤 3：根构建**

运行：`pnpm build` 预期：shared → backend → frontend 依次构建成功。

- [ ] **步骤 4：dev 冒烟**

运行：`pnpm dev` 预期：shared 先构建，随后 backend（`http://localhost:3000`）与 frontend（Vite dev server）正常启动；浏览器访问登录页无控制台报错、无模块解析错误。（若无法开浏览器，至少确认两个进程启动日志无 `Cannot find module '@lucy/shared'` 之类报错后 Ctrl+C。）

- [ ] **步骤 5：收尾 Commit（如验证中发现修复）**

如有修改：`git add -A && git commit -m "fix(shared): 验证阶段修复"` 如无修改：跳过。

---

## 自检结果

- **规格覆盖度**：Section 1（构建化）→ 任务 1；Section 2（新增类型）→ 任务 2；Section 3（后端）→ 任务 3；Section 4（前端）→ 任务 4；Section 5（验证）→ 任务 5。全章节覆盖。
- **占位符**：所有步骤含精确命令与完整代码，无 TODO/待定。
- **类型一致性**：后端用 `User as SharedUser` 别名规避与实体 `User` 冲突；shared `User.createdAt/updatedAt` 为 `Date`，与实体一致；`LoginResult extends AuthTokens` 与前后端消费一致。
