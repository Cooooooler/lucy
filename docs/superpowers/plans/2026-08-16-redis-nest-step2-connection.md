# @coool/redis-nest 连接模块 + DI + 统一异常（阶段 2/6）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 `RedisModule.forRoot/forRootAsync` 单全局连接（standalone/sentinel/cluster 三种模式 + 生产默认参数）、`RedisService`（get/set/del/exists + raw 透传）、`RedisException` 统一异常包装。全部 TDD。

**架构：** 纯函数 `normalizeOptions` 合并生产默认参数；`createClient` 工厂按 `type` 分支构建 ioredis `Redis`/`Cluster`；`RedisModule` 静态方法返回 `global: true` 的 DynamicModule，提供 `REDIS_CLIENT` token 与 `RedisService`，`onModuleDestroy` 关闭连接；`RedisService` 捕获 ioredis 错误并包装为 `RedisException`。

**技术栈：** TypeScript ESM（`moduleResolution: Bundler`，相对导入带 `.js`）、ioredis 5、@nestjs/common/core（peer）、vitest 4（`vi.hoisted` + `vi.mock('ioredis')` 免真实连接）、tsup 双构建。

**范围：** 仅本计划覆盖设计文档「步进交付顺序」第 2 步。命名客户端 + 命名空间（forFeature）归第 4 步，序列化归第 3 步，本步不做。

**规格依据：** `docs/superpowers/specs/2026-08-16-redis-nest-package-design.md`

**全局约束（逐字遵守）：**

- 相对导入一律带 `.js` 后缀；全 ESM。
- 测试从 `'vitest'` 显式 import，vitest.config.ts `globals: false`。
- 提交信息 type 小写（Conventional Commits），header ≤120。
- 不引入 `@nestjs/config`——`forRootAsync` 的 `useFactory` 由消费方负责从 config 读取。
- 不把 `RedisService` 的 client 依赖 `@nestjs/config`；仅注入 `REDIS_CLIENT`。
- 每个任务提交前 pre-commit 会全局跑 typegen/typecheck/test（含新包），必须保持全绿。

---

### 任务 1：连接选项 + 生产默认参数（纯函数）

**文件：**

- 创建：`packages/redis/src/options.ts`
- 测试：`packages/redis/src/options.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/options.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  defaultRetryStrategy,
  normalizeOptions,
} from './options.js';

describe('normalizeOptions', () => {
  it('合并生产默认参数', () => {
    const normalized = normalizeOptions({ type: 'standalone' });
    expect(normalized.maxRetriesPerRequest).toBe(20);
    expect(normalized.connectTimeout).toBe(10_000);
    expect(normalized.lazyConnect).toBe(true);
    expect(normalized.keepAlive).toBe(60_000);
  });

  it('用户显式覆盖默认参数', () => {
    const normalized = normalizeOptions({
      type: 'standalone',
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    expect(normalized.lazyConnect).toBe(false);
    expect(normalized.maxRetriesPerRequest).toBe(3);
  });

  it('未提供 retryStrategy 时注入默认指数退避', () => {
    const normalized = normalizeOptions({ type: 'standalone' });
    expect(normalized.retryStrategy).toBe(defaultRetryStrategy);
  });

  it('用户自定义 retryStrategy 被保留', () => {
    const custom = (times: number) => (times > 3 ? null : 100);
    const normalized = normalizeOptions({
      type: 'standalone',
      retryStrategy: custom,
    });
    expect(normalized.retryStrategy).toBe(custom);
  });

  it('保留连接模式字段', () => {
    const normalized = normalizeOptions({
      type: 'sentinel',
      sentinels: [{ host: 'a', port: 26379 }],
    });
    expect(normalized.type).toBe('sentinel');
  });
});

describe('defaultRetryStrategy', () => {
  it('指数退避并按上限封顶', () => {
    expect(defaultRetryStrategy(1)).toBe(50);
    expect(defaultRetryStrategy(50)).toBe(2_000);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/options.test.ts` 预期：FAIL，`normalizeOptions`/`defaultRetryStrategy` 未定义（模块不存在）。

- [ ] **步骤 3：实现 options.ts**

`packages/redis/src/options.ts`：

```ts
import type { Cluster, Redis } from 'ioredis';

export type RedisClient = Redis | Cluster;

export interface RedisConnectionOptions {
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  retryStrategy?: (times: number) => number | void | null;
}

export interface RedisStandaloneOptions extends RedisConnectionOptions {
  type: 'standalone';
  host?: string;
  port?: number;
}

export interface RedisSentinelOptions extends RedisConnectionOptions {
  type: 'sentinel';
  sentinels: { host: string; port: number }[];
  name?: string;
}

export interface RedisClusterOptions extends RedisConnectionOptions {
  type: 'cluster';
  clusterNodes: { host: string; port: number }[];
}

export type RedisModuleOptions =
  RedisStandaloneOptions | RedisSentinelOptions | RedisClusterOptions;

/** 生产默认参数（连接池/重试/重连/超时），可被用户选项覆盖 */
export const DEFAULT_OPTIONS = {
  maxRetriesPerRequest: 20,
  connectTimeout: 10_000,
  lazyConnect: true,
  keepAlive: 60_000,
};

/** 默认指数退避重连，上限 2s */
export function defaultRetryStrategy(times: number): number {
  return Math.min(times * 50, 2_000);
}

export interface NormalizedRedisOptions extends RedisModuleOptions {
  retryStrategy: (times: number) => number | void | null;
}

export function normalizeOptions(
  options: RedisModuleOptions,
): NormalizedRedisOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    retryStrategy: options.retryStrategy ?? defaultRetryStrategy,
  } as NormalizedRedisOptions;
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/options.test.ts` 预期：PASS（6 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/options.ts packages/redis/src/options.test.ts
git commit -m "feat(redis): add connection options and production defaults"
```

### 任务 2：RedisException 统一异常

**文件：**

- 创建：`packages/redis/src/redis.exception.ts`
- 测试：`packages/redis/src/redis.exception.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/redis.exception.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { RedisException, toRedisException } from './redis.exception.js';

describe('RedisException', () => {
  it('默认 code 为 REDIS_ERROR', () => {
    const e = new RedisException('boom');
    expect(e.name).toBe('RedisException');
    expect(e.code).toBe('REDIS_ERROR');
    expect(e.message).toBe('boom');
  });

  it('支持自定义 code 与 cause', () => {
    const cause = new Error('orig');
    const e = new RedisException('boom', { code: 'CONNECTION_BROKEN', cause });
    expect(e.code).toBe('CONNECTION_BROKEN');
    expect(e.cause).toBe(cause);
  });
});

describe('toRedisException', () => {
  it('已是指定类型则原样返回', () => {
    const e = new RedisException('x');
    expect(toRedisException(e)).toBe(e);
  });

  it('包装普通错误并保留 message 与 cause', () => {
    const orig = new Error('ECONNREFUSED');
    const wrapped = toRedisException(orig);
    expect(wrapped).toBeInstanceOf(RedisException);
    expect(wrapped.message).toBe('ECONNREFUSED');
    expect(wrapped.cause).toBe(orig);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/redis.exception.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 redis.exception.ts**

`packages/redis/src/redis.exception.ts`：

```ts
export class RedisException extends Error {
  readonly code: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { cause: options?.cause });
    this.name = 'RedisException';
    this.code = options?.code ?? 'REDIS_ERROR';
  }
}

export function toRedisException(error: unknown): RedisException {
  if (error instanceof RedisException) return error;
  const message =
    error instanceof Error ? error.message : 'Redis operation failed';
  return new RedisException(message, { cause: error });
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.exception.test.ts` 预期：PASS（4 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/redis.exception.ts packages/redis/src/redis.exception.test.ts
git commit -m "feat(redis): add RedisException unified error"
```

### 任务 3：createClient 工厂（standalone/sentinel/cluster）

**文件：**

- 创建：`packages/redis/src/client.factory.ts`
- 测试：`packages/redis/src/client.factory.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/client.factory.test.ts`（用 `vi.hoisted` + `vi.mock('ioredis')` 避免真实连接）：

```ts
import { describe, expect, it, vi } from 'vitest';

const { mockRedisCtor, mockClusterCtor } = vi.hoisted(() => ({
  mockRedisCtor: vi.fn(),
  mockClusterCtor: vi.fn(),
}));

vi.mock('ioredis', () => {
  class MockRedis {
    quit = vi.fn();
    constructor(...args: unknown[]) {
      mockRedisCtor(...args);
    }
  }
  class MockCluster extends MockRedis {}
  return { Redis: MockRedis, Cluster: MockCluster };
});

import { createClient } from './client.factory.js';
import { defaultRetryStrategy } from './options.js';

describe('createClient', () => {
  it('standalone 构建单机 Redis，带生产默认参数', () => {
    mockRedisCtor.mockClear();
    createClient({ type: 'standalone' });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('127.0.0.1');
    expect(arg.port).toBe(6379);
    expect(arg.lazyConnect).toBe(true);
    expect(arg.maxRetriesPerRequest).toBe(20);
    expect(arg.retryStrategy).toBe(defaultRetryStrategy);
  });

  it('standalone 尊重用户 host/port', () => {
    mockRedisCtor.mockClear();
    createClient({ type: 'standalone', host: 'r.example.com', port: 7000 });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('r.example.com');
    expect(arg.port).toBe(7000);
  });

  it('sentinel 透传 sentinels 与 name', () => {
    mockRedisCtor.mockClear();
    createClient({
      type: 'sentinel',
      sentinels: [{ host: 's1', port: 26379 }],
      name: 'mymaster',
    });
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.sentinels).toEqual([{ host: 's1', port: 26379 }]);
    expect(arg.name).toBe('mymaster');
  });

  it('cluster 走 Cluster 构造，公共参数放 redisOptions', () => {
    mockClusterCtor.mockClear();
    createClient({
      type: 'cluster',
      clusterNodes: [{ host: 'c1', port: 7001 }],
    });
    const [nodes, opts] = mockClusterCtor.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(nodes).toEqual([{ host: 'c1', port: 7001 }]);
    expect((opts.redisOptions as Record<string, unknown>).lazyConnect).toBe(
      true,
    );
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/client.factory.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 client.factory.ts**

`packages/redis/src/client.factory.ts`：

```ts
import { Cluster, Redis } from 'ioredis';
import {
  normalizeOptions,
  type NormalizedRedisOptions,
  type RedisClient,
  type RedisModuleOptions,
} from './options.js';

export function createClient(options: RedisModuleOptions): RedisClient {
  const normalized = normalizeOptions(options);
  switch (normalized.type) {
    case 'standalone':
      return new Redis({
        host: normalized.host ?? '127.0.0.1',
        port: normalized.port ?? 6379,
        ...buildCommonOptions(normalized),
      });
    case 'sentinel':
      return new Redis({
        sentinels: normalized.sentinels,
        name: normalized.name,
        ...buildCommonOptions(normalized),
      });
    case 'cluster':
      return new Cluster(normalized.clusterNodes, {
        redisOptions: buildCommonOptions(normalized),
      });
  }
}

function buildCommonOptions(options: NormalizedRedisOptions) {
  return {
    password: options.password,
    db: options.db,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    connectTimeout: options.connectTimeout,
    lazyConnect: options.lazyConnect,
    keepAlive: options.keepAlive,
    retryStrategy: options.retryStrategy,
  };
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/client.factory.test.ts` 预期：PASS（4 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/client.factory.ts packages/redis/src/client.factory.test.ts
git commit -m "feat(redis): add createClient factory for standalone/sentinel/cluster"
```

### 任务 4：RedisService（CRUD + 异常包装）

**文件：**

- 创建：`packages/redis/src/redis.constants.ts`
- 创建：`packages/redis/src/redis.service.ts`
- 测试：`packages/redis/src/redis.service.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/redis.constants.ts`：

```ts
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');
```

`packages/redis/src/redis.service.test.ts`（注入 mock client，不经真实连接）：

```ts
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisException } from './redis.exception.js';
import { RedisService } from './redis.service.js';

function mockClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
  };
}

async function buildService(client: ReturnType<typeof mockClient>) {
  const module = await Test.createTestingModule({
    providers: [{ provide: REDIS_CLIENT, useValue: client }, RedisService],
  }).compile();
  return module.get(RedisService);
}

describe('RedisService', () => {
  it('get 透传', async () => {
    const client = mockClient();
    client.get.mockResolvedValue('v');
    const svc = await buildService(client);
    await expect(svc.get('k')).resolves.toBe('v');
    expect(client.get).toHaveBeenCalledWith('k');
  });

  it('set 带 TTL 使用 EX', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.set('k', 'v', 60);
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
  });

  it('set 无 TTL 直接 set', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.set('k', 'v');
    expect(client.set).toHaveBeenCalledWith('k', 'v');
  });

  it('del 返回数量', async () => {
    const client = mockClient();
    client.del.mockResolvedValue(2);
    const svc = await buildService(client);
    await expect(svc.del('a', 'b')).resolves.toBe(2);
  });

  it('exists 归一为布尔', async () => {
    const client = mockClient();
    client.exists.mockResolvedValue(1);
    const svc = await buildService(client);
    await expect(svc.exists('k')).resolves.toBe(true);
  });

  it('ioredis 错误被包装为 RedisException', async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = await buildService(client);
    await expect(svc.get('k')).rejects.toBeInstanceOf(RedisException);
  });

  it('raw 暴露底层 client', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    expect(svc.raw).toBe(client);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/redis.service.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 redis.service.ts**

`packages/redis/src/redis.service.ts`：

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { toRedisException } from './redis.exception.js';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** 底层 ioredis 实例（逃生舱，供 BF.* / eval / pipeline 等高级用法，不经过异常包装） */
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

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toRedisException(error);
    }
  }
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.service.test.ts` 预期：PASS（7 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/redis.constants.ts packages/redis/src/redis.service.ts packages/redis/src/redis.service.test.ts
git commit -m "feat(redis): add RedisService CRUD with exception wrapping"
```

### 任务 5：RedisModule forRoot/forRootAsync

**文件：**

- 创建：`packages/redis/src/redis.module.ts`
- 测试：`packages/redis/src/redis.module.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/redis/src/redis.module.test.ts`：

```ts
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

const { mockRedisCtor } = vi.hoisted(() => ({ mockRedisCtor: vi.fn() }));

vi.mock('ioredis', () => {
  class MockRedis {
    quit = vi.fn();
    constructor(...args: unknown[]) {
      mockRedisCtor(...args);
    }
  }
  class MockCluster extends MockRedis {}
  return { Redis: MockRedis, Cluster: MockCluster };
});

describe('RedisModule', () => {
  it('forRoot 注册全局默认连接与 RedisService', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    expect(mockRedisCtor).toHaveBeenCalledTimes(1);
  });

  it('forRootAsync 通过 useFactory 构造连接', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          useFactory: () => ({ type: 'standalone', host: 'async.example.com' }),
        }),
      ],
    }).compile();
    expect(module.get(RedisService)).toBeInstanceOf(RedisService);
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('async.example.com');
  });

  it('forRootAsync 支持 inject 注入配置依赖', async () => {
    mockRedisCtor.mockClear();
    const provider = {
      provide: 'CFG',
      useValue: { host: 'cfg.example.com' },
    };
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          inject: ['CFG'],
          useFactory: (cfg: { host: string }) => ({
            type: 'standalone',
            host: cfg.host,
          }),
        }),
      ],
      providers: [provider],
    }).compile();
    const arg = mockRedisCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.host).toBe('cfg.example.com');
  });

  it('onModuleDestroy 关闭 client', async () => {
    mockRedisCtor.mockClear();
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ type: 'standalone' })],
    }).compile();
    await module.close();
    const client = module.get(REDIS_CLIENT) as {
      quit: ReturnType<typeof vi.fn>;
    };
    expect(client.quit).toHaveBeenCalled();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @coool/redis-nest test src/redis.module.test.ts` 预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 redis.module.ts**

`packages/redis/src/redis.module.ts`：

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
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

export interface RedisModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: unknown[];
  useFactory: (
    ...args: unknown[]
  ) => Promise<RedisModuleOptions> | RedisModuleOptions;
}

@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = createClient(options);
    return {
      module: RedisModule,
      global: true,
      providers: [{ provide: REDIS_CLIENT, useValue: client }, RedisService],
      exports: [REDIS_CLIENT, RedisService],
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
        RedisService,
      ],
      exports: [REDIS_CLIENT, RedisService],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @coool/redis-nest test src/redis.module.test.ts` 预期：PASS（4 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add packages/redis/src/redis.module.ts packages/redis/src/redis.module.test.ts
git commit -m "feat(redis): add RedisModule forRoot/forRootAsync global connection"
```

### 任务 6：导出公共 API + 全量验证

**文件：**

- 修改：`packages/redis/src/index.ts`

- [ ] **步骤 1：重写 index.ts 导出公共 API**

`packages/redis/src/index.ts`（替换占位导出，保留版本常量）：

```ts
export { createClient } from './client.factory.js';
export { REDIS_CLIENT } from './redis.constants.js';
export { RedisException, toRedisException } from './redis.exception.js';
export { RedisModule } from './redis.module.js';
export type { RedisModuleAsyncOptions } from './redis.module.js';
export { RedisService } from './redis.service.js';
export {
  DEFAULT_OPTIONS,
  defaultRetryStrategy,
  normalizeOptions,
} from './options.js';
export type {
  RedisClient,
  RedisClusterOptions,
  RedisConnectionOptions,
  RedisModuleOptions,
  RedisSentinelOptions,
  RedisStandaloneOptions,
} from './options.js';

export const REDIS_NEST_VERSION = '0.1.0';
```

- [ ] **步骤 2：运行全量验证**

运行：`pnpm --filter @coool/redis-nest test` 预期：全部用例通过（含 index.test.ts 断言 `REDIS_NEST_VERSION === '0.1.0'`）。

运行：`pnpm --filter @coool/redis-nest build && ls packages/redis/dist` 预期：dist 产出 index.js/.cjs/.d.ts/.d.cts。

运行：`pnpm --filter @coool/redis-nest typecheck` 预期：无错误。

运行：`pnpm --filter @coool/redis-nest lint` 预期：无错误。

- [ ] **步骤 3：Commit**

```bash
git add packages/redis/src/index.ts
git commit -m "feat(redis): export public API for connection module"
```

> 注：pre-commit 钩子在每次提交时全局跑 typegen/typecheck/test（含新包），确保分支始终可合并。若 lint-staged 改动格式，如实保留。
