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
  // Nest DI 无法静态推导注入值类型，官方(如 TypeOrmModuleAsyncOptions)亦用 any[]，与 no-explicit-any 规则冲突故局部豁免
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
