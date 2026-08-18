# 多数据源（forFeature）

`RedisModule.forFeature` 返回模块作用域的 feature RedisService，支持**命名空间（key 前缀）**与**命名客户端（独立连接）**，可组合。

```ts
RedisModule.forFeature({
  name?: string,        // 命名客户端名称
  namespace?: string,   // key 前缀（固定）
  options?: RedisModuleOptions, // 命名客户端的连接配置（提供 options 时创建独立连接）
});
```

## key 前缀命名空间

共享默认连接，所有键操作自动加前缀，用于模块间 key 隔离：

```ts
@Module({
  imports: [RedisModule.forFeature({ namespace: 'auth' })],
})
export class AuthModule {
  constructor(private readonly redis: RedisService) {}
  // 注入的 RedisService 所有 key 自动加 'auth:' 前缀
}
```

## 命名客户端（独立连接）

提供 `name` + `options` 时创建独立连接，按名注入：

```ts
@Module({
  imports: [
    RedisModule.forFeature({
      name: 'cache',
      options: { type: 'standalone', host: 'cache.example.com', port: 7000 },
    }),
  ],
})
export class CacheModule {} // 注入 RedisService 绑定到独立 cache 连接
```

命名客户端 token 可单独注入：`getNamedClientToken('cache')`。应用关闭时统一关闭。

## 组合

```ts
RedisModule.forFeature({
  name: 'cache',
  namespace: 'auth',
  options: { type: 'standalone', serializer: mySerializer },
});
```

> `forFeature` 是模块作用域（局部 provider 优先于全局 forRoot）；`options.serializer` 用于命名客户端时优先于全局序列化器。
