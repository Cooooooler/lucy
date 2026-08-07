# @lucy/shared 共享类型下沉 + 可构建化设计

日期：2026-08-06分支：feature/auth-login

## 背景与目标

前后端存在同一概念类型各维护一份的问题，长期会漂移：

| 概念 | 前端定义 | 后端定义 |
| --- | --- | --- |
| 用户实体 | `stores/auth.ts` 的 `User`（缺 `createdAt`/`updatedAt`） | `auth.service.ts` 的 `SafeUser`（含 `Date` 时间戳） |
| 令牌对 | `api/types.ts` 的 `AuthTokens` | `auth.service.ts` 内联 `{ accessToken, refreshToken }` |
| 登录结果 | `api/types.ts` 的 `LoginResult` | `auth.service.ts` 内联 `{ accessToken, refreshToken, user }` |
| 响应信封 | `client.ts` 的 `ApiEnvelope` | shared 已有 `ApiResponse`（前端未复用） |

同时 `@lucy/shared` 目前 `main` 直接指向 `src/index.ts`（裸 TS 源码），无 build 脚本，后端生产运行时依赖 Node 类型擦除加载 `.ts`，是隐患。

目标：

1. 将上述共享类型下沉到 `@lucy/shared`，前后端统一消费，消除维护漂移。
2. 把 `@lucy/shared` 整理成标准可构建包（双格式 CJS+ESM），彻底解决裸 TS 问题。

## 决策记录

- **范围**：下沉 auth 类型 + 整理 shared 构建。后端 `RegisterDto`/`LoginDto` 请求体本次不下沉（前端未重复定义，无漂移）。
- **时间戳类型**：`User.createdAt`/`updatedAt` 用 `Date`，贴合后端实体。前端当前不使用时间戳，该类型不诚实（JSON 实为 ISO 字符串）留作后续处理。
- **构建格式**：双格式 CJS + ESM（方案 A）。后端为 CJS 消费者（`package.json` 无 `"type":"module"`， `nodenext` 产物为 `require`），前端为 ESM 消费者，各走原生路径。
- **不改后端模块格式**：后端保持 CommonJS，不做 ESM 化（涉及 73 处相对导入加扩展名等大改动，独立推进）。

## Section 1：shared 包构建化

- `packages/shared` 新增 devDependency `tsup`。
- `package.json` 脚本：
  - `build`: `tsup src/index.ts --format cjs,esm --dts`
  - `dev`: 同上追加 `--watch`
- `exports` map（双格式，无 dual-package hazard）：

  ```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    }
  },
  "files": ["dist"]
  ```

- 产物 `dist/` 加入 `.gitignore`；`src/` 仍是唯一源码。
- `turbo.json`：`dev` 任务加 `dependsOn: ["^build"]`，保证前端/后端 dev 启动前 shared 已构建（`build` 任务已有 `^build` 依赖，无需改）。

## Section 2：shared 新增类型（src/index.ts）

```ts
export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export interface LoginResult extends AuthTokens {
  user: User;
}
```

现有 `ApiResponse` / `ErrorCode` / `PageQuery` / `PageResult` 保留不动。

## Section 3：后端消费 shared

- `auth.service.ts`：
  - 删除本地 `SafeUser` 定义，改用 `import type { User, AuthTokens, LoginResult } from '@lucy/shared'`。
  - `toSafeUser` 返回 `User`；`register`/`me` 返回 `Promise<User>`。
  - `login` 返回 `LoginResult`；`refresh` 返回 `AuthTokens`。
- `auth.controller.ts`：`SafeUser` 类型引用改 shared `User`（`register`/`me` 返回类型）。
- 同步更新 `auth.service.spec.ts` / `auth.controller.spec.ts` 中的 `SafeUser` 引用。

## Section 4：前端消费 shared

- `frontend/package.json` 新增依赖 `"@lucy/shared": "workspace:*"`。
- `stores/auth.ts`：删除本地 `User` 定义，改 `import type { User } from '@lucy/shared'`。 `AuthState`/`PersistedSession` 引用 shared `User`。
- `api/types.ts`：整体删除；`api/auth.ts`、`client.ts` 的 `AuthTokens`/`LoginResult` 直接从 `@lucy/shared` 导入。
- `client.ts`：删除本地 `ApiEnvelope`，`unwrapResponse` 改用 shared `ApiResponse`。

## Section 5：验证

1. `pnpm --filter @lucy/shared build`：产出 `dist/index.js`（CJS）、`dist/index.mjs`（ESM）、及 `.d.ts`/`.d.mts`。
2. 根 `pnpm typecheck` 全绿。
3. 根 `pnpm test` 全绿。
4. `pnpm --filter frontend build` 通过（前端类型解析走 exports 的 ESM 分支）。
5. `pnpm dev` 冒烟：后端启动、前端登录页可访问。

## 范围外

- 后端 ESM 化（独立重构，另行评估）。
- 后端请求体 DTO（`RegisterDto`/`LoginDto`/`RefreshDto`）类型下沉（前端未重复定义）。
- 前端对 `Date` 时间戳的运行时转换（当前未使用时间戳字段）。
