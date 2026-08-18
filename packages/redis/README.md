# @coool/redis-nest

NestJS Redis 集成模块：**连接管理 · 序列化 · DI · 多数据源 · 统一异常**。

基于 `ioredis` 的轻量封装，解决连接池配置坑、序列化混乱、DI 体验差、原始异常满天飞四大痛点。

> 完整文档见 [VitePress 文档站](docs/index.md)（本地预览：`pnpm docs:dev`）。

## 特性

- **连接管理**：`forRoot` / `forRootAsync` 支持单机、哨兵、Cluster 三种模式，内置生产默认参数（重试、重连、超时）。
- **统一 DI**：`RedisService` 注入即用，全局模块（`global: true`）。
- **统一异常**：ioredis 底层错误包装为 `RedisException`，带稳定错误码。
- **序列化**：默认 JSON，自定义序列化器可替换，自动处理 Date；`setJson` / `getJson` 开箱即用。
- **逃生舱**：`RedisService.raw` 暴露底层 client，供 `BF.*`、`eval`、`pipeline` 等高级用法。

> 多数据源（`forFeature`）、工具（`hashTag`/`pipeline`）规划中，见[路线图](docs/guide/roadmap.md)。

## 安装

```bash
pnpm add @coool/redis-nest ioredis
```

`@nestjs/common`、`@nestjs/core` 为 peerDependencies。

## 快速开始

```ts
import { Module } from '@nestjs/common';
import { RedisModule, RedisService } from '@coool/redis-nest';

@Module({
  imports: [
    RedisModule.forRoot({ type: 'standalone', host: '127.0.0.1', port: 6379 }),
  ],
})
export class AppModule {}

@Injectable()
export class SomeService {
  constructor(private readonly redis: RedisService) {}

  async run(): Promise<void> {
    await this.redis.set('greeting', 'hello', 60);
    const value = await this.redis.get('greeting');
    await this.redis.del('greeting');
  }
}
```

## 本地文档预览

```bash
pnpm --filter @coool/redis-nest docs:dev   # http://localhost:5173
```

## License

MIT
