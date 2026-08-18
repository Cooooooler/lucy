# 连接配置

`forRoot(options)` / `forRootAsync` 接收一个 `RedisModuleOptions`。它由**连接模式判别联合**与**共用连接参数**组成，`type` 决定构建 `Redis` 还是 `Cluster`。

## 连接模式

### 单机 standalone

```ts
RedisModule.forRoot({
  type: 'standalone',
  host: '127.0.0.1', // 默认 127.0.0.1
  port: 6379, // 默认 6379
});
```

### 哨兵 sentinel

```ts
RedisModule.forRoot({
  type: 'sentinel',
  sentinels: [
    { host: 'sentinel-1', port: 26379 },
    { host: 'sentinel-2', port: 26379 },
  ],
  name: 'mymaster',
});
```

### Cluster 集群

```ts
RedisModule.forRoot({
  type: 'cluster',
  clusterNodes: [
    { host: 'node-1', port: 7001 },
    { host: 'node-2', port: 7002 },
  ],
});
```

## 共用连接参数

以下参数对所有模式生效，均可被用户覆盖：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `password` | `string` | 认证密码 |
| `db` | `number` | 数据库编号 |
| `maxRetriesPerRequest` | `number` | 单命令最大重试次数（默认 `20`） |
| `connectTimeout` | `number` | 连接超时毫秒（默认 `10000`） |
| `lazyConnect` | `boolean` | 惰性连接，首个命令时才建立（默认 `true`） |
| `keepAlive` | `number` | keep-alive 毫秒（默认 `60000`） |
| `retryStrategy` | `(times) => number \| void \| null` | 重连策略，返回下次重试前等待毫秒；未提供时用默认指数退避（上限 2s） |

## 生产默认参数

库内置了生产默认参数（`DEFAULT_OPTIONS`），未显式指定时自动生效：

```ts
{
  maxRetriesPerRequest: 20,
  connectTimeout: 10_000,
  lazyConnect: true,
  keepAlive: 60_000,
}
```

默认重连策略为指数退避 `min(times * 50, 2000)`，可经 `retryStrategy` 覆盖。

> 序列化（`getJson/setJson`）、多数据源（`forFeature`）规划中，详见对应页面。
