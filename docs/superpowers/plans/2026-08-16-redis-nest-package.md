# @coool/redis-nest 包骨架实现计划（阶段 1/6）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `packages/redis` 建立可发布的 NestJS Redis 库骨架——tsup 双构建（ESM+CJS）、peer 依赖、类型导出、接入 turbo。

**架构：** 新包 `@coool/redis-nest` 镜像 `packages/shared` 的工程配置（tsup/eslint/tsconfig，工具链由根 node_modules 提升共享），但改为可发布（非 `private`）且输出 ESM+CJS 双格式。仅含一个占位导出，供后续阶段（连接模块/序列化/DI 等）逐步填充。

**技术栈：** TypeScript ESM、tsup 8、vitest 4、eslint 9（typescript-eslint + prettier）。peerDependencies：`@nestjs/common` `@nestjs/core` `ioredis`。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」的第 1 步（包骨架）。后续 5 步另起计划。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`

---

### 任务 1：包工程配置（package.json / tsconfig / eslint / vitest）

**文件：**

- 创建：`packages/redis/package.json`
- 创建：`packages/redis/tsconfig.json`
- 创建：`packages/redis/tsconfig.build.json`
- 创建：`packages/redis/eslint.config.mjs`
- 创建：`packages/redis/vitest.config.ts`

- [ ] **步骤 1：创建 package.json**

`packages/redis/package.json`：

```json
{
  "name": "@coool/redis-nest",
  "version": "0.1.0",
  "description": "NestJS Redis integration module: connection management, serialization, DI, multi-source, unified errors",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --clean --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts --format esm,cjs --clean --dts --watch --tsconfig tsconfig.build.json",
    "lint": "eslint \"src/**/*.ts\" --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepublishOnly": "pnpm run build && pnpm run test"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "ioredis": "^5.11.0"
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/core": "^11.0.1",
    "ioredis": "^5.11.1"
  }
}
```

- [ ] **步骤 2：创建 tsconfig.json 与 tsconfig.build.json**

`packages/redis/tsconfig.json`（镜像 shared）：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "esnext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`packages/redis/tsconfig.build.json`（镜像 shared，含 `ignoreDeprecations` 规避 tsup dts 注入 baseUrl 触发的 TS5101）：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "ignoreDeprecations": "6.0"
  }
}
```

- [ ] **步骤 3：创建 eslint.config.mjs**

`packages/redis/eslint.config.mjs`（镜像 shared，省略 scripts 块——本包无 scripts 目录）：

```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import base from '../../eslint.base.mjs';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '*.config.*']),

  js.configs.recommended,

  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  ...base,
]);
```

- [ ] **步骤 4：创建 vitest.config.ts**

`packages/redis/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **步骤 5：注册 workspace 并安装依赖**

运行：`pnpm install` 预期：pnpm 识别新包 `@coool/redis-nest`（`packages/*` 已被 pnpm-workspace.yaml 覆盖，无需改配置），lockfile 更新，peer/dev 依赖（@nestjs、ioredis）解析到根提升的 node_modules。

### 任务 2：占位源码 + 冒烟测试

**文件：**

- 创建：`packages/redis/src/index.ts`
- 创建：`packages/redis/src/index.test.ts`

- [ ] **步骤 1：创建占位导出**

`packages/redis/src/index.ts`：

```ts
/** @coool/redis-nest 骨架占位导出；后续阶段将导出 RedisModule/RedisService 等 */
export const REDIS_NEST_VERSION = '0.1.0';
```

- [ ] **步骤 2：创建冒烟测试**

`packages/redis/src/index.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { REDIS_NEST_VERSION } from './index.js';

describe('@coool/redis-nest 骨架', () => {
  it('导出占位版本常量', () => {
    expect(REDIS_NEST_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **步骤 3：运行测试验证通过**

运行：`pnpm --filter @coool/redis-nest test` 预期：PASS，`1 passed`。

- [ ] **步骤 4：验证 build 产出双格式**

运行：`pnpm --filter @coool/redis-nest build && ls packages/redis/dist` 预期：`index.js`（ESM）、`index.cjs`（CJS）、`index.d.ts`（类型）三者齐全。

- [ ] **步骤 5：验证 typecheck 与 lint**

运行：`pnpm --filter @coool/redis-nest typecheck` 预期：无错误退出。

运行：`pnpm --filter @coool/redis-nest lint` 预期：无 lint 错误。

- [ ] **步骤 6：验证 turbo 全局任务包含新包**

运行：`pnpm turbo run build test typecheck lint --filter=@coool/redis-nest` 预期：4 个任务全部成功，无缓存（首次跑）。

- [ ] **步骤 7：Commit**

```bash
git add packages/redis pnpm-lock.yaml
git commit -m "feat(redis): scaffold @coool/redis-nest package skeleton"
```

> 注：pre-commit 钩子会全局跑 typegen/typecheck/test，新包脚本会被纳入，必须全部通过；lint-staged 会对新建 `src/**/*.ts` 跑 prettier（`.prettierrc` 的 `endOfLine: auto` 与 `eslint.base.mjs` 一致）。
