# @coool/redis-nest forFeature（阶段 4/6）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 `RedisModule.forFeature({ name?, namespace?, options? })`——命名客户端（独立连接，按名字注入）与 key 前缀命名空间（共享连接 + 固定前缀），让模块消费方获得作用域化的 feature RedisService。

**架构：** `RedisService` 增加可选 `namespace` 构造参数与 `prefixed(key)` 私有方法（所有键操作自动加前缀）；`RedisModule.forFeature` 返回 `module: RedisModule` 的作用域 DynamicModule，解析 feature 客户端（命名 → `createClient(options)` 新连接并按 `getNamedClientToken(name)` 注册；否则共享全局 `REDIS_CLIENT`），并提供一个绑定了该客户端与 namespace 的 `RedisService` 实例（覆盖全局，使消费模块注入 `RedisService` 即得 feature 版本）。

**技术栈：** TypeScript ESM、@nestjs/common（DI）、vitest 4、ioredis 5。沿用既有 tsup/vitest 配置。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」第 4 步。hashTag/pipeline（第 5 步）本步不做。**命名客户端在应用关闭时的主动 quit 本步不作为硬性目标**（默认连接经 lazyConnect 惰性建立、进程退出由 OS 回收；记 final triage，后续可补）。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`

**全局约束（逐字遵守）：**

- 相对导入带 `.js`；全 ESM；测试从 `'vitest'` 显式 import。
- 提交信息 type 小写（Conventional Commits），header ≤120。
- `RedisService` 构造 `(client, serializer, namespace?)`——namespace 为第三个普通参数，不 `@Inject`（默认服务经 DI 注入时 namespace 为 undefined，向后兼容）。
- `forFeature` 返回作用域 DynamicModule，`module: RedisModule`，不 `global`（只对导入它的模块可见）。
- 命名客户端 token：`Symbol.for(\`REDIS_CLIENT:${name}\`)`。
- 每个任务提交前 pre-commit 全局跑 typegen/typecheck/test，必须保持全绿。

---

### 任务 1：RedisService 支持 namespace（key 前缀）

**文件：**

- 修改：`packages/redis/src/redis.service.ts`
- 测试：`packages/redis/src/redis.service.test.ts`

- [ ] **步骤 1：实现 namespace 前缀逻辑**

`packages/redis/src/redis.service.ts` 改造（构造加第 3 参、加 `prefixed`，所有键操作走前缀）：

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import { toRedisException } from './redis.exception.js';
import type { RedisSerializer } from './serializer.js';

@Injectable()
export class RedisService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SERIALIZER) private readonly serializer: RedisSerializer,
    /** key 前缀命名空间（固定前缀），forFeature 使用；默认无前缀 */
    private readonly namespace?: string,
  ) {}

  /** 底层 ioredis 实例（逃生舱，供 BF、eval、pipeline 等高级用法，不经过异常包装，key 不自动加前缀） */
  get raw(): Redis {
    return this.client;
  }

  /** 有 namespace 时给 key 加固定前缀 */
  private prefixed(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }

  async get(key: string): Promise<string | null> {
    return this.wrap(() => this.client.get(this.prefixed(key)));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const k = this.prefixed(key);
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(k, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(k, value);
      }
    });
  }

  async del(...keys: string[]): Promise<number> {
    return this.wrap(() =>
      this.client.del(...keys.map((k) => this.prefixed(k))),
    );
  }

  async exists(key: string): Promise<boolean> {
    return this.wrap(
      async () => (await this.client.exists(this.prefixed(key))) === 1,
    );
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const k = this.prefixed(key);
    const text = this.serializer.serialize(value);
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(k, text, 'EX', ttlSeconds);
      } else {
        await this.client.set(k, text);
      }
    });
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const text = await this.get(key);
    return text === null ? null : (this.serializer.deserialize(text) as T);
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toRedisException(error);
    }
  }
}
```

- [ ] **步骤 2：新增 namespace 测试**

`packages/redis/src/redis.service.test.ts` 末尾追加（直接 `new RedisService` 构造，验证前缀）：

```ts
import type { Redis } from 'ioredis';

it('namespace 下 get 自动加前缀', async () => {
  const client = mockClient();
  client.get.mockResolvedValue('v');
  const svc = new RedisService(
    client as unknown as Redis,
    defaultJsonSerializer,
    'auth',
  );
  await svc.get('k');
  expect(client.get).toHaveBeenCalledWith('auth:k');
});

it('namespace 下 set 带 TTL 加前缀', async () => {
  const client = mockClient();
  const svc = new RedisService(
    client as unknown as Redis,
    defaultJsonSerializer,
    'auth',
  );
  await svc.set('k', 'v', 60);
  expect(client.set).toHaveBeenCalledWith('auth:k', 'v', 'EX', 60);
});

it('namespace 下 del 全部加前缀', async () => {
  const client = mockClient();
  client.del.mockResolvedValue(2);
  const svc = new RedisService(
    client as unknown as Redis,
    defaultJsonSerializer,
    'auth',
  );
  await svc.del('a', 'b');
  expect(client.del).toHaveBeenCalledWith('auth:a', 'auth:b');
});

it('namespace 下 getJson 加前缀', async () => {
  const client = mockClient();
  client.get.mockResolvedValue('{"a":1}');
  const svc = new RedisService(
    client as unknown as Redis,
    defaultJsonSerializer,
    'auth',
  );
  await svc.getJson('k');
  expect(client.get).toHaveBeenCalledWith('auth:k');
});
```

- [ ] **步骤 3：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.service.test.ts` 预期：PASS（原 13 用例 + 新增 4 用例 = 17 用例）。

- [ ] **步骤 4：Commit**

```bash
git add packages/redis/src/redis.service.ts packages/redis/src/redis.service.test.ts
git commit -m "feat(redis): add namespace key prefix to RedisService"
```

### 任务 2：RedisModule.forFeature

**文件：**

- 修改：`packages/redis/src/redis.constants.ts`
- 修改：`packages/redis/src/redis.module.ts`
- 测试：`packages/redis/src/redis.module.test.ts`

- [ ] **步骤 1：constants 加 getNamedClientToken**

`packages/redis/src/redis.constants.ts` 末尾追加：

```ts
/** 生成命名客户端 DI token：`REDIS_CLIENT:<name>`（Symbol.for 全局共享，跨模块解析到同一实例） */
export function getNamedClientToken(name: string): symbol {
  return Symbol.for(`REDIS_CLIENT:${name}`);
}
```

- [ ] **步骤 2：module 加 RedisFeatureOptions 与 forFeature**

`packages/redis/src/redis.module.ts` 加导入与 `forFeature` 静态方法、`RedisFeatureOptions` 接口：

```ts
import type { Redis } from 'ioredis';
// 顶部 import 增加：
import { getNamedClientToken, REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import type { RedisSerializer } from './serializer.js';

/** forFeature 配置：namespace 为 key 前缀；name+options 创建独立命名连接，否则共享默认连接 */
export interface RedisFeatureOptions {
  namespace?: string;
  name?: string;
  options?: RedisModuleOptions;
}

// RedisModule 类内，onModuleDestroy 之前加：
  /** 返回模块作用域的 feature RedisService：namespace 加 key 前缀；name+options 用独立命名连接 */
  static forFeature(options: RedisFeatureOptions): DynamicModule {
    const { name, namespace, options: connOptions } = options;
    const isNamed = connOptions !== undefined;
    const clientToken = isNamed
      ? getNamedClientToken(name ?? 'default')
      : REDIS_CLIENT;
    return {
      module: RedisModule,
      providers: [
        ...(isNamed
          ? [
              {
                provide: clientToken,
                useFactory: () => createClient(connOptions as RedisModuleOptions),
              },
            ]
          : []),
        {
          provide: RedisService,
          useFactory: (client: RedisClient, serializer: RedisSerializer) =>
            new RedisService(client as Redis, serializer, namespace),
          inject: [clientToken, REDIS_SERIALIZER],
        },
      ],
      exports: isNamed ? [clientToken, RedisService] : [RedisService],
    };
  }
```

- [ ] **步骤 3：module 测试新增 forFeature 用例**

`packages/redis/src/redis.module.test.ts` 末尾追加（复用 vi.mock('ioredis') 的 mockRedisCtor；命名客户端单独可测，确定性）：

```ts
it('forFeature name+options 创建独立命名连接并提供 RedisService', async () => {
  mockRedisCtor.mockClear();
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forFeature({
        name: 'cache',
        options: { type: 'standalone', host: 'cache.example.com', port: 7000 },
      }),
    ],
  }).compile();
  expect(module.get(RedisService)).toBeInstanceOf(RedisService);
  expect(mockRedisCtor).toHaveBeenCalledTimes(1);
  const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
  expect(arg.host).toBe('cache.example.com');
  expect(arg.port).toBe(7000);
});

it('forFeature name 暴露命名客户端 token', async () => {
  mockRedisCtor.mockClear();
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forFeature({
        name: 'cache',
        options: { type: 'standalone', host: 'cache.example.com' },
      }),
    ],
  }).compile();
  expect(module.get(getNamedClientToken('cache'))).toBeDefined();
});

it('forFeature name+namespace+options 组合可用', async () => {
  mockRedisCtor.mockClear();
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forFeature({
        name: 'cache',
        namespace: 'auth',
        options: { type: 'standalone' },
      }),
    ],
  }).compile();
  expect(module.get(RedisService)).toBeInstanceOf(RedisService);
  expect(mockRedisCtor).toHaveBeenCalledTimes(1);
});

it('forRoot + forFeature namespace：feature 服务覆盖全局（局部优先）', async () => {
  mockRedisCtor.mockClear();
  // 消费 feature RedisService 的服务放在 import forFeature 的 FeatureModule 里，
  // 验证它拿到的是 forFeature 提供的实例（局部 provider 优先于全局）
  const provided: { redis: unknown }[] = [];
  @Injectable()
  class Consumer {
    constructor(private readonly redis: RedisService) {
      provided.push({ redis });
    }
  }
  @Module({
    imports: [RedisModule.forFeature({ namespace: 'auth' })],
    providers: [Consumer],
  })
  class FeatureModule {}
  const module = await Test.createTestingModule({
    imports: [RedisModule.forRoot({ type: 'standalone' }), FeatureModule],
  }).compile();
  module.get(Consumer);
  expect(mockRedisCtor).toHaveBeenCalledTimes(1); // 仅 forRoot 建连，feature 复用默认连接
  expect(provided[0].redis).toBeInstanceOf(RedisService);
});
```

> 命名空间对 key 的前缀行为由任务 1 的 RedisService 单测直接覆盖；本任务 module 测试聚焦「forFeature 注入正确的 RedisService + 命名客户端创建/暴露 token + 局部优先」。`@Module`/`@Injectable` 装饰器已在文件顶部从 `@nestjs/common` 导入，`RedisService` 已导入。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.module.test.ts` 预期：PASS（原 7 用例 + 新增 4 用例 = 11 用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/redis.constants.ts packages/redis/src/redis.module.ts packages/redis/src/redis.module.test.ts
git commit -m "feat(redis): add forFeature named clients and namespaces"
```

### 任务 3：导出公共 API + 全量验证

**文件：**

- 修改：`packages/redis/src/index.ts`

- [ ] **步骤 1：index.ts 导出 forFeature 相关**

`packages/redis/src/index.ts` 补导出：

```ts
export {
  getNamedClientToken,
  REDIS_CLIENT,
  REDIS_SERIALIZER,
} from './redis.constants.js';
export type { RedisFeatureOptions } from './redis.module.js';
```

（把原 `export { REDIS_CLIENT, REDIS_SERIALIZER }` 行改为合并 `getNamedClientToken`；并在 RedisModuleAsyncOptions 的 type 导出处补 `RedisFeatureOptions`。）

- [ ] **步骤 2：全量验证**

运行：`pnpm --filter @coool/redis-nest test` 预期：全部用例通过。

运行：`pnpm --filter @coool/redis-nest typecheck` 预期：无错误。

运行：`pnpm --filter @coool/redis-nest lint` 预期：无错误。

- [ ] **步骤 3：Commit**

```bash
git add packages/redis/src/index.ts
git commit -m "feat(redis): export forFeature public API"
```

> 注：pre-commit 钩子每次提交全局跑 typegen/typecheck/test（含新包），确保分支始终可合并。lint-staged 会 prettier 重排导出顺序，语义不变。
