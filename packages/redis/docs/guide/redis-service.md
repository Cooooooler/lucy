# RedisService

`RedisService` 是注入式门面，封装了常用 CRUD 命令，并把 ioredis 底层错误统一包装为 `RedisException`。

## 方法

### `get(key): Promise<string | null>`

取原始字符串值；key 不存在返回 `null`。

### `set(key, value, ttlSeconds?)`

写入字符串；传入 `ttlSeconds` 时附加 `EX` 过期时间。

```ts
await this.redis.set('key', 'value'); // 无过期
await this.redis.set('key', 'value', 60); // 60 秒后过期
```

### `del(...keys): Promise<number>`

删除若干 key，返回实际删除的数量。

### `exists(key): Promise<boolean>`

判断 key 是否存在，归一为布尔值。

### `sadd(key, ...members): Promise<number>`

向集合添加若干成员，返回实际新增的数量。

```ts
await this.redis.sadd('family', 'token-a'); // 1
```

### `srem(key, ...members): Promise<number>`

从集合移除若干成员，返回实际移除的数量。

### `smembers(key): Promise<string[]>`

返回集合的全部成员。

```ts
const members = await this.redis.smembers('family');
```

### `sismember(key, member): Promise<boolean>`

判断成员是否属于集合，归一为布尔值。

### `expire(key, ttlSeconds): Promise<boolean>`

设置 key 的过期时间（秒）；key 不存在时返回 `false`。

### `setJson(key, value, ttlSeconds?)`

序列化写入：value 经序列化器转字符串（Date 自动处理）；传 `ttlSeconds` 时附加 `EX` 过期。

```ts
await this.redis.setJson('user:1', { name: 'Alice', at: new Date() }, 60);
```

### `getJson<T>(key): Promise<T | null>`

序列化读取：文本经序列化器还原（ISO 日期自动转回 `Date`）；key 不存在返回 `null`。

```ts
const user = await this.redis.getJson<{ name: string; at: Date }>('user:1');
```

> 序列化器细节见 [序列化](./serialization)。

### `pipeline()`

返回底层 ioredis pipeline，可链式追加命令后 `exec()` 批量执行：

```ts
const pipeline = this.redis.pipeline();
pipeline.set('a', '1');
pipeline.set('b', '2');
const results = await pipeline.exec();
```

> 与 `raw` 一致，pipeline 的 key 不自动加前缀。详见[工具](./utilities)。

### `raw`

底层 ioredis 实例（逃生舱），供高级用法（`BF.*`、`eval`、`pipeline` 等）直接操作，**不经过异常包装**：

```ts
await this.redis.raw.call('BF.ADD', 'bloom', token);
```

> 常规集合操作（`sadd`/`smembers` 等）已由门面提供，优先用门面而非 `raw`。

## 示例

```ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '@coool/redis-nest';

@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  async setString(key: string, value: string): Promise<void> {
    await this.redis.set(key, value, 60);
  }

  async getString(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setObject(key: string, value: unknown): Promise<void> {
    await this.redis.setJson(key, value, 60);
  }

  async has(key: string): Promise<boolean> {
    return this.redis.exists(key);
  }
}
```
