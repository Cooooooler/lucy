# @coool/redis-nest 序列化层（阶段 3/6）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现序列化层——`RedisSerializer` 接口、默认 JSON 序列化器（自动处理 Date）、`RedisService.getJson/setJson`，并让 serializer 可经模块配置替换。

**架构：** 纯模块 `serializer.ts` 定义 `RedisSerializer` 接口与 `defaultJsonSerializer`（serialize 把 Date 转 ISO 字符串、deserialize 把 ISO-8601 日期字符串还原为 Date）；`REDIS_SERIALIZER` token 在 `RedisModule.forRoot/forRootAsync` 提供（默认 `defaultJsonSerializer`，可用 options.serializer 覆盖）；`RedisService` 注入 serializer，新增 `getJson/setJson` 两个方法走序列化层。

**技术栈：** TypeScript ESM、@nestjs/common（DI）、vitest 4。沿用既有 tsup/vitest 配置。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」第 3 步。forFeature（第 4 步）、hashTag/pipeline（第 5 步）本步不做。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`

**全局约束（逐字遵守）：**

- 相对导入带 `.js`；全 ESM；测试从 `'vitest'` 显式 import。
- 提交信息 type 小写（Conventional Commits），header ≤120。
- `RedisService` 构造改为注入 `REDIS_CLIENT` + `REDIS_SERIALIZER` 两个 token。
- serializer 作为可选字段挂在 `RedisConnectionOptions` 上（三种连接模式继承），createClient 的 `buildCommonOptions` 不把它传给 ioredis。
- 每个任务提交前 pre-commit 全局跑 typegen/typecheck/test，必须保持全绿（任务拆分保证每步提交后测试仍通过）。

---

### 任务 1：序列化器纯模块

**文件：**

- 创建：`packages/redis/src/serializer.ts`
- 测试：`packages/redis/src/serializer.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/serializer.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { defaultJsonSerializer, isIsoDateString } from './serializer.js';

describe('isIsoDateString', () => {
  it('识别 ISO-8601 日期字符串', () => {
    expect(isIsoDateString('2026-08-16T10:00:00Z')).toBe(true);
    expect(isIsoDateString('2026-08-16T10:00:00.123Z')).toBe(true);
  });
  it('拒绝非日期字符串', () => {
    expect(isIsoDateString('hello')).toBe(false);
    expect(isIsoDateString('2026-08-16')).toBe(false);
    expect(isIsoDateString('not-a-date')).toBe(false);
  });
});

describe('defaultJsonSerializer', () => {
  it('序列化普通对象', () => {
    expect(defaultJsonSerializer.serialize({ a: 1, b: 'x' })).toBe(
      '{"a":1,"b":"x"}',
    );
  });
  it('顶层 Date 序列化为 ISO 字符串', () => {
    expect(
      defaultJsonSerializer.serialize(new Date('2026-08-16T10:00:00Z')),
    ).toBe('"2026-08-16T10:00:00.000Z"');
  });
  it('对象内 Date 也被序列化为 ISO', () => {
    expect(
      defaultJsonSerializer.serialize({ at: new Date('2026-08-16T10:00:00Z') }),
    ).toBe('{"at":"2026-08-16T10:00:00.000Z"}');
  });
  it('反序列化还原普通 JSON', () => {
    expect(defaultJsonSerializer.deserialize('{"a":1}')).toEqual({ a: 1 });
  });
  it('反序列化把 ISO 日期字符串还原为 Date', () => {
    const v = defaultJsonSerializer.deserialize(
      '{"at":"2026-08-16T10:00:00.000Z"}',
    ) as { at: Date };
    expect(v.at).toBeInstanceOf(Date);
    expect(v.at.toISOString()).toBe('2026-08-16T10:00:00.000Z');
  });
  it('serialize/deserialize round-trip 保持 Date 类型', () => {
    const v = defaultJsonSerializer.deserialize(
      defaultJsonSerializer.serialize({ at: new Date('2026-08-16T10:00:00Z') }),
    ) as { at: Date };
    expect(v.at).toBeInstanceOf(Date);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/serializer.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 serializer.ts**

`packages/redis/src/serializer.ts`：

```ts
/** 可替换的序列化器：setJson/getJson 走 serialize/deserialize */
export interface RedisSerializer {
  serialize(value: unknown): string;
  deserialize(text: string): unknown;
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** 判断字符串是否为严格 ISO-8601 日期格式（反序列化时据此还原 Date） */
export function isIsoDateString(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

/** 默认 JSON 序列化器：Date 存为 ISO 字符串，读回时还原为 Date */
export const defaultJsonSerializer: RedisSerializer = {
  serialize(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
      v instanceof Date ? v.toISOString() : v,
    );
  },
  deserialize(text: string): unknown {
    return JSON.parse(text, (_key, v) =>
      typeof v === 'string' && isIsoDateString(v) ? new Date(v) : v,
    );
  },
};
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/serializer.test.ts` 预期：PASS（10 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/serializer.ts packages/redis/src/serializer.test.ts
git commit -m "feat(redis): add default JSON serializer with Date handling"
```

### 任务 2：模块提供 REDIS_SERIALIZER

**文件：**

- 修改：`packages/redis/src/options.ts`
- 修改：`packages/redis/src/redis.constants.ts`
- 修改：`packages/redis/src/redis.module.ts`
- 测试：`packages/redis/src/redis.module.test.ts`

- [ ] **步骤 1：在 RedisConnectionOptions 加 serializer 字段**

`packages/redis/src/options.ts` 顶部加导入、`RedisConnectionOptions` 加字段：

```ts
import type { Cluster, Redis } from 'ioredis';
import type { RedisSerializer } from './serializer.js';

export type RedisClient = Redis | Cluster;

/** 所有连接模式共用的连接参数（serializer 为模块级配置，不传给 ioredis） */
export interface RedisConnectionOptions {
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  retryStrategy?: (times: number) => number | void | null;
  /** 自定义序列化器；默认 defaultJsonSerializer */
  serializer?: RedisSerializer;
}
```

- [ ] **步骤 2：redis.constants.ts 加 token**

`packages/redis/src/redis.constants.ts` 追加：

```ts
/** DI token：标识底层 ioredis 客户端实例 */
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');

/** DI token：标识序列化器实例（默认 defaultJsonSerializer） */
export const REDIS_SERIALIZER = Symbol.for('REDIS_SERIALIZER');
```

- [ ] **步骤 3：redis.module.ts 提供并导出 REDIS_SERIALIZER**

`packages/redis/src/redis.module.ts` 修改导入与 forRoot/forRootAsync：

```ts
import {
  DynamicModule,
  Inject,
  Module,
  OnModuleDestroy,
  type ModuleMetadata,
} from '@nestjs/common';
import { createClient } from './client.factory.js';
import type { RedisClient, RedisModuleOptions } from './options.js';
import { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import { RedisService } from './redis.service.js';
import { defaultJsonSerializer } from './serializer.js';

export interface RedisModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<RedisModuleOptions> | RedisModuleOptions;
}

@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = createClient(options);
    const serializer = options.serializer ?? defaultJsonSerializer;
    return {
      module: RedisModule,
      global: true,
      providers: [
        { provide: REDIS_CLIENT, useValue: client },
        { provide: REDIS_SERIALIZER, useValue: serializer },
        RedisService,
      ],
      exports: [REDIS_CLIENT, REDIS_SERIALIZER, RedisService],
    };
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: REDIS_CLIENT,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) =>
            createClient(await options.useFactory(...args)),
        },
        {
          provide: REDIS_SERIALIZER,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) =>
            (await options.useFactory(...args)).serializer ??
            defaultJsonSerializer,
        },
        RedisService,
      ],
      exports: [REDIS_CLIENT, REDIS_SERIALIZER, RedisService],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
```

> 注：`forRootAsync` 中 `useFactory` 会被 REDIS_CLIENT 与 REDIS_SERIALIZER 各调用一次（用于派生两个值），属 Nest 异步配置的常见代价；useFactory 应为读取配置的纯函数。

- [ ] **步骤 4：redis.module.test.ts 加 serializer 用例**

`packages/redis/src/redis.module.test.ts` 顶部补导入、末尾追加用例：

```ts
import { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import { defaultJsonSerializer } from './serializer.js';
```

```ts
it('forRoot 默认提供 defaultJsonSerializer', async () => {
  mockRedisCtor.mockClear();
  const module = await Test.createTestingModule({
    imports: [RedisModule.forRoot({ type: 'standalone' })],
  }).compile();
  expect(module.get(REDIS_SERIALIZER)).toBe(defaultJsonSerializer);
});

it('forRoot 支持自定义 serializer', async () => {
  mockRedisCtor.mockClear();
  const custom = { serialize: () => 'X', deserialize: () => 'Y' };
  const module = await Test.createTestingModule({
    imports: [RedisModule.forRoot({ type: 'standalone', serializer: custom })],
  }).compile();
  expect(module.get(REDIS_SERIALIZER)).toBe(custom);
});

it('forRootAsync useFactory 返回自定义 serializer', async () => {
  mockRedisCtor.mockClear();
  const custom = { serialize: () => 'X', deserialize: () => 'Y' };
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        useFactory: () => ({ type: 'standalone', serializer: custom }),
      }),
    ],
  }).compile();
  expect(module.get(REDIS_SERIALIZER)).toBe(custom);
});
```

- [ ] **步骤 5：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.module.test.ts` 预期：PASS（原 4 用例 + 新增 3 用例 = 7 用例）。

- [ ] **步骤 6：Commit**

```bash
git add packages/redis/src/options.ts packages/redis/src/redis.constants.ts packages/redis/src/redis.module.ts packages/redis/src/redis.module.test.ts
git commit -m "feat(redis): provide REDIS_SERIALIZER in RedisModule"
```

### 任务 3：RedisService 注入 serializer + getJson/setJson

**文件：**

- 修改：`packages/redis/src/redis.service.ts`
- 测试：`packages/redis/src/redis.service.test.ts`

- [ ] **步骤 1：改造 redis.service.ts 注入 serializer 并新增方法**

`packages/redis/src/redis.service.ts`（构造加注入，新增 getJson/setJson）：

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
  ) {}

  /** 底层 ioredis 实例（逃生舱，供 BF、eval、pipeline 等高级用法，不经过异常包装） */
  get raw(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.wrap(() => this.client.get(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    });
  }

  async del(...keys: string[]): Promise<number> {
    return this.wrap(() => this.client.del(...keys));
  }

  async exists(key: string): Promise<boolean> {
    return this.wrap(async () => (await this.client.exists(key)) === 1);
  }

  /** 序列化写入：value 经 serializer 转字符串（Date 自动处理）；传 ttlSeconds 时附加 EX 过期 */
  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const text = this.serializer.serialize(value);
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, text, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, text);
      }
    });
  }

  /** 序列化读取：文本经 serializer 还原；key 不存在返回 null */
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

- [ ] **步骤 2：改造 redis.service.test.ts**

`packages/redis/src/redis.service.test.ts`——buildService 增加 serializer 注入，新增 getJson/setJson 用例：

```ts
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import { RedisException } from './redis.exception.js';
import { RedisService } from './redis.service.js';
import { defaultJsonSerializer, type RedisSerializer } from './serializer.js';

function mockClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
  };
}

async function buildService(
  client: ReturnType<typeof mockClient>,
  serializer: RedisSerializer = defaultJsonSerializer,
) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: REDIS_CLIENT, useValue: client },
      { provide: REDIS_SERIALIZER, useValue: serializer },
      RedisService,
    ],
  }).compile();
  return module.get(RedisService);
}
```

保留原有 7 个用例，末尾追加：

```ts
it('setJson 走 serializer 后写入', async () => {
  const client = mockClient();
  const svc = await buildService(client);
  await svc.setJson('k', { a: 1 }, 60);
  expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 60);
});

it('setJson 无 TTL 直接写入', async () => {
  const client = mockClient();
  const svc = await buildService(client);
  await svc.setJson('k', { a: 1 });
  expect(client.set).toHaveBeenCalledWith('k', '{"a":1}');
});

it('getJson 反序列化返回对象', async () => {
  const client = mockClient();
  client.get.mockResolvedValue('{"a":1}');
  const svc = await buildService(client);
  await expect(svc.getJson<{ a: number }>('k')).resolves.toEqual({ a: 1 });
});

it('getJson 无 key 返回 null', async () => {
  const client = mockClient();
  client.get.mockResolvedValue(null);
  const svc = await buildService(client);
  await expect(svc.getJson('k')).resolves.toBeNull();
});

it('getJson 自动还原 Date', async () => {
  const client = mockClient();
  client.get.mockResolvedValue('{"at":"2026-08-16T10:00:00.000Z"}');
  const svc = await buildService(client);
  const v = await svc.getJson<{ at: Date }>('k');
  expect(v?.at).toBeInstanceOf(Date);
});

it('自定义序列化器被使用', async () => {
  const client = mockClient();
  const custom: RedisSerializer = {
    serialize: () => 'C',
    deserialize: () => 'D',
  };
  const svc = await buildService(client, custom);
  await svc.setJson('k', 'any');
  expect(client.set).toHaveBeenCalledWith('k', 'C');
  client.get.mockResolvedValue('ignored');
  await expect(svc.getJson('k')).resolves.toBe('D');
});
```

- [ ] **步骤 3：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.service.test.ts` 预期：PASS（原 7 用例 + 新增 6 用例 = 13 用例）。

- [ ] **步骤 4：Commit**

```bash
git add packages/redis/src/redis.service.ts packages/redis/src/redis.service.test.ts
git commit -m "feat(redis): add getJson/setJson serialization methods"
```

### 任务 4：导出公共 API + 全量验证

**文件：**

- 修改：`packages/redis/src/index.ts`

- [ ] **步骤 1：index.ts 导出 serializer 相关**

`packages/redis/src/index.ts` 补导出：

```ts
export { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
export { defaultJsonSerializer, isIsoDateString } from './serializer.js';
export type { RedisSerializer } from './serializer.js';
```

（原 `export { REDIS_CLIENT } from './redis.constants.js';` 行改为上面对 `REDIS_CLIENT, REDIS_SERIALIZER` 的导出。）

- [ ] **步骤 2：全量验证**

运行：`pnpm --filter @coool/redis-nest test` 预期：全部用例通过（serializer 10 + service 13 + module 7 + options 6 + client.factory 4 + index 1 = 41 用例）。

运行：`pnpm --filter @coool/redis-nest typecheck` 预期：无错误。

运行：`pnpm --filter @coool/redis-nest lint` 预期：无错误。

- [ ] **步骤 3：Commit**

```bash
git add packages/redis/src/index.ts
git commit -m "feat(redis): export serializer public API"
```

> 注：pre-commit 钩子每次提交全局跑 typegen/typecheck/test（含新包），确保分支始终可合并。lint-staged 会 prettier 重排导出顺序，语义不变。
