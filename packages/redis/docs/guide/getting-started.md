# 快速开始

## 安装

`@coool/redis-nest` 的 peerDependencies 为 `@nestjs/common`、`@nestjs/core` 与 `ioredis`，需一并安装：

```bash
pnpm add @coool/redis-nest ioredis
# @nestjs/common、@nestjs/core 通常已在 NestJS 应用中存在
```

## 注册全局连接

在根模块用 `forRoot` 注册一次，模块为全局（`global: true`），应用内任何地方都可注入 `RedisService`：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@coool/redis-nest';

@Module({
  imports: [
    RedisModule.forRoot({ type: 'standalone', host: '127.0.0.1', port: 6379 }),
  ],
})
export class AppModule {}
```

若连接配置来自环境变量/配置中心，用 `forRootAsync`：

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@coool/redis-nest';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'standalone',
        host: config.get('REDIS_HOST', '127.0.0.1'),
        port: config.get<number>('REDIS_PORT', 6379),
      }),
    }),
  ],
})
export class AppModule {}
```

## 使用 RedisService

```ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '@coool/redis-nest';

@Injectable()
export class SomeService {
  constructor(private readonly redis: RedisService) {}

  async run(): Promise<void> {
    await this.redis.set('greeting', 'hello', 60); // 60 秒过期
    const value = await this.redis.get('greeting'); // 'hello'
    await this.redis.del('greeting');
  }
}
```

> `RedisModule` 是全局模块，`SomeService` 无需再次 `imports` RedisModule 即可注入 `RedisService`。
