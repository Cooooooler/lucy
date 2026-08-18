# @coool/redis-nest 工具 + 集成测试（阶段 5/6）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 `hashTag` 散列槽标签工具、`RedisService.pipeline()` 封装，并补充针对真实 Redis 的集成测试。档位 A 的最后一步。

**架构：** 纯函数 `hashTag(key) = \`{${key}}\`` 生成 Redis Cluster 散列槽标签；`RedisService.pipeline()`委托底层`client.pipeline()`（可链式追加命令后 `exec`批量执行）；集成测试用`describe.skipIf(!redisAvailable)` 在无 Redis 时跳过（本地无 Redis 不影响单测，CI 有 Redis 则真实执行），覆盖 set/get、setJson/getJson 含 Date、pipeline 批量。

**技术栈：** TypeScript ESM、ioredis 5、@nestjs/common（DI）、vitest 4（v8 coverage 已配置）、CI GitHub Actions。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」第 5 步。backend 狗食化迁移（第 6 步）本步不做。README 已在前序完成。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`

**全局约束（逐字遵守）：**

- 相对导入带 `.js`；全 ESM；测试从 `'vitest'` 显式 import。
- 提交信息 type 小写（Conventional Commits），header ≤120。
- `hashTag` 为纯函数；`pipeline()` 委托底层 client，不自行实现批量逻辑。
- 集成测试文件在 `src/` 下（`*.integration.test.ts`），被 vitest 默认 include 收录、被 coverage exclude 排除；用 `describe.skipIf` 在探测不到 Redis 时跳过。
- 每个任务提交前 pre-commit 全局跑 typegen/typecheck/test，必须保持全绿。

---

### 任务 1：hashTag 散列槽标签工具

**文件：**

- 创建：`packages/redis/src/hash-tag.ts`
- 测试：`packages/redis/src/hash-tag.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/hash-tag.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { hashTag } from './hash-tag.js';

describe('hashTag', () => {
  it('生成 {key} 散列槽标签', () => {
    expect(hashTag('user:123')).toBe('{user:123}');
  });
  it('保留嵌套 key 原样包裹', () => {
    expect(hashTag('auth:refresh:abc')).toBe('{auth:refresh:abc}');
  });
  it('空字符串包裹为 {}', () => {
    expect(hashTag('')).toBe('{}');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/hash-tag.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 hash-tag.ts**

`packages/redis/src/hash-tag.ts`：

```ts
/**
 * 生成 Redis Cluster 散列槽标签：把 key 包进 `{}`，
 * 使共享同一标签的相关 key 路由到同一槽位（如 `user:{123}:profile`、`user:{123}:sessions`）。
 */
export function hashTag(key: string): string {
  return `{${key}}`;
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/hash-tag.test.ts` 预期：PASS（3 用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/hash-tag.ts packages/redis/src/hash-tag.test.ts
git commit -m "feat(redis): add hashTag utility"
```

### 任务 2：RedisService.pipeline()

**文件：**

- 修改：`packages/redis/src/redis.service.ts`
- 测试：`packages/redis/src/redis.service.test.ts`

- [ ] **步骤 1：实现 pipeline() 委托**

`packages/redis/src/redis.service.ts` 的 `raw` getter 之后加方法：

```ts
  /** 获取底层 ioredis pipeline：可链式追加命令，最后 exec() 批量执行（key 不自动加前缀） */
  pipeline(): ReturnType<Redis['pipeline']> {
    return this.client.pipeline();
  }
```

- [ ] **步骤 2：补测试**

`packages/redis/src/redis.service.test.ts` 的 `mockClient()` 加 `pipeline: vi.fn()`，末尾追加用例：

```ts
function mockClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    pipeline: vi.fn(),
  };
}
```

```ts
it('pipeline 委托给底层 client', async () => {
  const client = mockClient();
  const pipeline = { exec: vi.fn().mockResolvedValue([]) };
  client.pipeline.mockReturnValue(pipeline);
  const svc = await buildService(client);
  expect(svc.pipeline()).toBe(pipeline);
  expect(client.pipeline).toHaveBeenCalledTimes(1);
});
```

- [ ] **步骤 3：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.service.test.ts` 预期：PASS（原 18 用例 + 新增 1 用例 = 19 用例）。

- [ ] **步骤 4：Commit**

```bash
git add packages/redis/src/redis.service.ts packages/redis/src/redis.service.test.ts
git commit -m "feat(redis): add pipeline wrapper to RedisService"
```

### 任务 3：集成测试（真实 Redis）

**文件：**

- 创建：`packages/redis/src/redis.integration.test.ts`
- 修改：`.github/workflows/build.yml`

- [ ] **步骤 1：创建集成测试**

`packages/redis/src/redis.integration.test.ts`（连真实 Redis，探测不到则整组跳过）：

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

/** 探测本地 Redis 是否可用（CI 由 redis service 提供，本地常无） */
async function probeRedis(): Promise<boolean> {
  const client = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
  });
  try {
    await client.ping();
    await client.quit();
    return true;
  } catch {
    try {
      await client.disconnect();
    } catch {
      /* noop */
    }
    return false;
  }
}

const redisAvailable = await probeRedis();

describe.skipIf(!redisAvailable)('RedisService 集成（真实 Redis）', () => {
  let module: TestingModule;
  let service: RedisService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    service = module.get(RedisService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('set/get round-trip', async () => {
    const key = `it:str:${Date.now()}`;
    await service.set(key, 'value', 60);
    await expect(service.get(key)).resolves.toBe('value');
    await service.del(key);
  });

  it('setJson/getJson round-trip（含 Date 还原）', async () => {
    const key = `it:json:${Date.now()}`;
    const at = new Date('2026-08-16T10:00:00Z');
    await service.setJson(key, { a: 1, at }, 60);
    const value = await service.getJson<{ a: number; at: Date }>(key);
    expect(value?.a).toBe(1);
    expect(value?.at).toBeInstanceOf(Date);
    await service.del(key);
  });

  it('pipeline 批量执行', async () => {
    const key = `it:pipeline:${Date.now()}`;
    const pipeline = service.pipeline();
    pipeline.set(key, 'x');
    pipeline.get(key);
    const results = await pipeline.exec();
    expect(results?.[1]?.[1]).toBe('x');
    await service.del(key);
  });
});
```

- [ ] **步骤 2：CI redis-tests job 加 redis service**

`.github/workflows/build.yml` 的 `redis-tests` job 顶部（`runs-on` 之后）加 services（与 backend-tests 相同）：

```yaml
runs-on: tenki-standard-small-2c-4g
services:
  redis:
    image: redis/redis-stack-server:latest
    ports:
      - 6379:6379
```

- [ ] **步骤 3：本地验证（无 Redis 时跳过）**

运行：`pnpm --filter @coool/redis-nest test src/redis.integration.test.ts` 预期：若本地无 Redis，组被跳过（SKIP）；若有则 PASS。

- [ ] **步骤 4：Commit**

```bash
git add packages/redis/src/redis.integration.test.ts .github/workflows/build.yml
git commit -m "test(redis): add real-redis integration tests"
```

> 注：CI 的 redis-tests job 有 redis service，集成测试会在 CI 真实执行并计入 `test:cov`（但集成测试文件本身被 coverage exclude）。

### 任务 4：导出 hashTag + 全量验证

**文件：**

- 修改：`packages/redis/src/index.ts`

- [ ] **步骤 1：index.ts 导出 hashTag**

`packages/redis/src/index.ts` 加导出：

```ts
export { hashTag } from './hash-tag.js';
```

- [ ] **步骤 2：全量验证**

运行：`pnpm --filter @coool/redis-nest test` 预期：全部用例通过（本地无 Redis 时集成组跳过）。

运行：`pnpm --filter @coool/redis-nest test:cov` 预期：coverage 生成（lcov），无回归。

运行：`pnpm --filter @coool/redis-nest typecheck` 预期：无错误。

运行：`pnpm --filter @coool/redis-nest lint` 预期：无错误。

运行：`pnpm --filter @coool/redis-nest build` 预期：dist 四格式产出。

- [ ] **步骤 3：Commit**

```bash
git add packages/redis/src/index.ts
git commit -m "feat(redis): export hashTag public API"
```

> 注：pre-commit 钩子每次提交全局跑 typegen/typecheck/test（含新包），确保分支始终可合并。
