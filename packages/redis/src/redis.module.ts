import {
  DynamicModule,
  Inject,
  Module,
  OnModuleDestroy,
  Optional,
  type ModuleMetadata,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createClient } from './client.factory.js';
import type { RedisClient, RedisModuleOptions } from './options.js';
import {
  getNamedClientToken,
  REDIS_CLIENT,
  REDIS_MODULE_OPTIONS,
  REDIS_NAMED_CLIENTS,
  REDIS_SERIALIZER,
} from './redis.constants.js';
import { RedisService } from './redis.service.js';
import type { RedisSerializer } from './serializer.js';
import { defaultJsonSerializer } from './serializer.js';

/** forRootAsync 的异步配置：useFactory 可注入依赖（如 ConfigService）读取连接配置 */
export interface RedisModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  // Nest DI 无法静态推导注入值类型，官方(如 TypeOrmModuleAsyncOptions)亦用 any[]，与 no-explicit-any 规则冲突故局部豁免
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];

  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<RedisModuleOptions> | RedisModuleOptions;
}

/** forFeature 配置：namespace 为 key 前缀；name+options 创建独立命名连接，否则共享默认连接 */
export interface RedisFeatureOptions {
  namespace?: string;
  name?: string;
  options?: RedisModuleOptions;
}

/**
 * Redis 连接模块。通过 `forRoot`/`forRootAsync` 注册全局 Redis 连接与 RedisService，
 * 应用关闭时断开连接。必须经由静态方法使用，不可直接 import 本类。
 */
@Module({})
export class RedisModule implements OnModuleDestroy {
  /** client 可选：forFeature 命名作用域模块不提供默认连接，故 @Optional 允许缺省 */
  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly client?: RedisClient,
    /** 命名客户端注册表（由 forRoot 提供），应用关闭时统一关闭 */
    @Optional()
    @Inject(REDIS_NAMED_CLIENTS)
    private readonly namedClients?: Set<RedisClient>,
  ) {}

  /** 同步注册全局 Redis 连接（连接在模块初始化时惰性建立） */
  static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = createClient(options);
    const serializer = options.serializer ?? defaultJsonSerializer;
    return {
      module: RedisModule,
      global: true,
      providers: [
        { provide: REDIS_CLIENT, useValue: client },
        { provide: REDIS_SERIALIZER, useValue: serializer },
        { provide: REDIS_NAMED_CLIENTS, useValue: new Set<RedisClient>() },
        RedisService,
      ],
      exports: [
        REDIS_CLIENT,
        REDIS_SERIALIZER,
        REDIS_NAMED_CLIENTS,
        RedisService,
      ],
    };
  }

  /** 异步注册全局连接：useFactory 只调用一次，解析后的配置派生出 client 与 serializer */
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) =>
            (await options.useFactory(...args)) as RedisModuleOptions,
        },
        {
          provide: REDIS_CLIENT,
          inject: [REDIS_MODULE_OPTIONS],
          useFactory: (opts: RedisModuleOptions) => createClient(opts),
        },
        {
          provide: REDIS_SERIALIZER,
          inject: [REDIS_MODULE_OPTIONS],
          useFactory: (opts: RedisModuleOptions) =>
            opts.serializer ?? defaultJsonSerializer,
        },
        { provide: REDIS_NAMED_CLIENTS, useValue: new Set<RedisClient>() },
        RedisService,
      ],
      exports: [
        REDIS_CLIENT,
        REDIS_SERIALIZER,
        REDIS_NAMED_CLIENTS,
        RedisService,
      ],
    };
  }

  /** 应用关闭时断开连接，避免悬挂连接句柄（含命名 feature 客户端，一次性关闭后清空避免重复） */
  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    if (this.namedClients && this.namedClients.size > 0) {
      const clients = [...this.namedClients];
      this.namedClients.clear();
      await Promise.all(clients.map((c) => c.quit()));
    }
  }

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
                // 命名客户端登记进注册表，供 onModuleDestroy 统一关闭（缺注册表时跳过）
                useFactory: (namedClients?: Set<RedisClient>) => {
                  const client = createClient(
                    connOptions as RedisModuleOptions,
                  );
                  namedClients?.add(client);
                  return client;
                },
                inject: [{ token: REDIS_NAMED_CLIENTS, optional: true }],
              },
            ]
          : []),
        {
          provide: RedisService,
          // 命名客户端优先用 connOptions.serializer；否则用注入的全局 serializer；都缺省回退默认
          useFactory: (client: RedisClient, serializer: RedisSerializer) =>
            new RedisService(
              client as Redis,
              connOptions?.serializer ?? serializer ?? defaultJsonSerializer,
              namespace,
            ),
          inject: [clientToken, { token: REDIS_SERIALIZER, optional: true }],
        },
      ],
      exports: isNamed ? [clientToken, RedisService] : [RedisService],
    };
  }
}
