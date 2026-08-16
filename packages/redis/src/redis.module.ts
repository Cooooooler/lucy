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

/**
 * Redis 连接模块。通过 `forRoot`/`forRootAsync` 注册全局 Redis 连接与 RedisService，
 * 应用关闭时断开连接。必须经由静态方法使用，不可直接 import 本类。
 */
@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  /** 同步注册全局 Redis 连接（连接在模块初始化时惰性建立） */
  static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = createClient(options);
    return {
      module: RedisModule,
      global: true,
      providers: [{ provide: REDIS_CLIENT, useValue: client }, RedisService],
      exports: [REDIS_CLIENT, RedisService],
    };
  }

  /** 异步注册全局连接：useFactory 可注入依赖返回连接配置，常用于从配置中心/环境读取 */
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

  /** 应用关闭时断开连接，避免悬挂连接句柄 */
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
