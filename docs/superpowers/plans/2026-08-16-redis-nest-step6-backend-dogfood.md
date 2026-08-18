# @coool/redis-nest backend 狗食化迁移（阶段 6/6）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 backend 消费 `@coool/redis-nest` 包，替换其本地手写的 RedisModule/RedisService/constants（删除），DenylistService 留业务侧复用包的 `REDIS_CLIENT` 与异常。用真实业务验证库的可用性（狗食化）。

**架构：** backend `package.json` 加 `@coool/redis-nest: workspace:*`；`AppModule` 用包的 `RedisModule.forRootAsync`（经 `ConfigService` 读 REDIS_HOST/PORT）替代本地 RedisModule；`AuthService` 的 `RedisService` 改从包导入，`redis.client.*` 改为 `redis.raw.*`；`DenylistService` 从包导入 `REDIS_CLIENT`，改由 `AuthModule` 提供（原由全局本地 RedisModule 提供）。

**关键约束：** pre-commit 每次提交全局跑 typegen/typecheck/test。删除本地 `redis.constants.ts` 会破坏 `denylist.service.spec.ts`、`auth.service` 改 `raw` 会破坏 `auth.service.spec.ts` mock——因此**代码迁移与测试改造必须原子提交**，不允许中间出现挂掉的状态。

**技术栈：** NestJS 11（Express）、TypeScript ESM（nodenext）、ioredis 5、Vitest 4。`@coool/redis-nest` 为 workspace 包（纯 ESM，nodenext 解析 exports.import）。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」第 6 步。不改前端；不重构 DenylistService 的 RedisBloom 逻辑（仅改 client 来源）。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`（决策 C：DenylistService 留在业务侧复用库的 client 与异常）

**全局约束（逐字遵守）：**

- 全仓 ESM，相对导入带 `.js` 后缀；`@coool/redis-nest` 的 `RedisModule` 为全局模块（`global: true`）。
- `RedisService.raw` 暴露底层 client（逃生舱），`redis.client.*` 一律改 `redis.raw.*`。
- 删除 backend 本地 `redis.module.ts`/`redis.service.ts`/`redis.constants.ts`/`redis.service.spec.ts`；保留 `denylist.service.ts` 与 `denylist.service.spec.ts`。
- `DenylistService` 由 `AuthModule` providers 提供（AuthService、JwtStrategy 均在其内）。
- 任务 1 为单次原子提交（代码 + 测试一起），任务 2 仅验证。

---

### 任务 1：完整迁移（代码 + 测试，单次原子提交）

**文件：**

- 修改：`apps/backend/package.json`
- 修改：`apps/backend/src/app.module.ts`
- 修改：`apps/backend/src/auth/auth.service.ts`
- 修改：`apps/backend/src/auth/auth.module.ts`
- 修改：`apps/backend/src/redis/denylist.service.ts`
- 修改：`apps/backend/src/auth/auth.service.spec.ts`
- 修改：`apps/backend/src/redis/denylist.service.spec.ts`
- 删除：`apps/backend/src/redis/redis.module.ts`、`apps/backend/src/redis/redis.service.ts`、`apps/backend/src/redis/redis.constants.ts`、`apps/backend/src/redis/redis.service.spec.ts`

- [ ] **步骤 1：backend 加 @coool/redis-nest 依赖**

运行：`pnpm --filter @lucy/backend add @coool/redis-nest@workspace:*` 预期：backend package.json dependencies 出现 `"@coool/redis-nest": "workspace:*"`，lockfile 更新。

- [ ] **步骤 2：删除本地 redis 实现（module/service/constants/spec）**

```bash
git rm apps/backend/src/redis/redis.module.ts apps/backend/src/redis/redis.service.ts apps/backend/src/redis/redis.constants.ts apps/backend/src/redis/redis.service.spec.ts
```

- [ ] **步骤 3：AppModule 改用包的 RedisModule.forRootAsync**

`apps/backend/src/app.module.ts`：

- `import { RedisModule } from './redis/redis.module.js';` → `import { RedisModule } from '@coool/redis-nest';`
- imports 数组里 `RedisModule,` →：

```ts
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'standalone' as const,
        host: config.get<string>('REDIS_HOST', '127.0.0.1'),
        port: config.get<number>('REDIS_PORT', 6379),
      }),
    }),
```

（`ConfigService` 已从 `@nestjs/config` 导入。）

- [ ] **步骤 4：AuthService 从包导入 RedisService 并改用 raw**

`apps/backend/src/auth/auth.service.ts`：

- `import { RedisService } from '../redis/redis.service.js';` → `import { RedisService } from '@coool/redis-nest';`
- 全部 `this.redis.client.` → `this.redis.raw.`（sadd/expire/smembers/srem，共 4 处）。

- [ ] **步骤 5：DenylistService 从包导入 REDIS_CLIENT**

`apps/backend/src/redis/denylist.service.ts`：

- `import { REDIS_CLIENT } from './redis.constants.js';` → `import { REDIS_CLIENT } from '@coool/redis-nest';`

- [ ] **步骤 6：AuthModule 提供 DenylistService**

`apps/backend/src/auth/auth.module.ts`：

- 加 `import { DenylistService } from '../redis/denylist.service.js';`
- providers 数组加 `DenylistService`。

- [ ] **步骤 7：更新测试**

`apps/backend/src/auth/auth.service.spec.ts`：

- `import { RedisService } from '../redis/redis.service.js';` → `import { RedisService } from '@coool/redis-nest';`
- redisService mock 的 `client: redisClient` → `raw: redisClient`。

`apps/backend/src/redis/denylist.service.spec.ts`：

- `import { REDIS_CLIENT } from './redis.constants.js';` → `import { REDIS_CLIENT } from '@coool/redis-nest';`

（`jwt.strategy.spec.ts` 无改动——仍从 `../redis/denylist.service.js` 导入，该文件保留。）

- [ ] **步骤 8：验证**

先构建包再后端验证：

```bash
pnpm --filter @coool/redis-nest build
pnpm --filter @lucy/backend typecheck
pnpm --filter @lucy/backend test
```

预期：typecheck 无错误；backend 全部测试通过（auth.service.spec、denylist.service.spec、jwt.strategy.spec 等）。

- [ ] **步骤 9：Commit（原子）**

```bash
git add apps/backend/package.json pnpm-lock.yaml apps/backend/src
git commit -m "refactor(backend): migrate redis access to @coool/redis-nest"
```

> pre-commit 全局跑 typegen/typecheck/test；本提交包含完整代码+测试迁移，必须全绿。

### 任务 2：全量验证

**文件：** 无（仅验证）

- [ ] **步骤 1：backend build + test:cov**

运行：`pnpm --filter @lucy/backend build && pnpm --filter @lucy/backend test:cov` 预期：build 通过、coverage ≥80% 门槛（redis.service 删除后 coverage 应仍达标；DenylistService 由 denylist.spec 覆盖）。

- [ ] **步骤 2：全仓 turbo 验证**

运行：`pnpm turbo run build test typecheck lint --filter=@lucy/backend` 预期：backend 全绿（包已由其依赖先构建）。

- [ ] **步骤 3：Commit（如有遗留）**

若验证暴露问题，修复后提交；否则无额外提交。

> 注：`@coool/redis-nest` 的 onModuleDestroy 统一 quit 默认连接与命名客户端，替代了原 backend RedisModule 的手动 quit，无连接泄漏。
