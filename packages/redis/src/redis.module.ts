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
        RedisService,
      ],
      exports: [REDIS_CLIENT, REDIS_SERIALIZER, RedisService],
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
        RedisService,
      ],
      exports: [REDIS_CLIENT, REDIS_SERIALIZER, RedisService],
    };
  }

  /** 应用关闭时断开连接，避免悬挂连接句柄（命名 feature 作用域无默认连接时跳过） */
  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
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
                useFactory: () =>
                  createClient(connOptions as RedisModuleOptions),
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
