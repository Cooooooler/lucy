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

### `raw`

底层 ioredis 实例（逃生舱），供高级用法（`BF.*`、`eval`、`pipeline` 等）直接操作，**不经过异常包装**：

```ts
await this.redis.raw.sadd('family', token);
```

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

  async has(key: string): Promise<boolean> {
    return this.redis.exists(key);
  }
}
```

> 序列化版本 `getJson` / `setJson`（自动 JSON 编解码与 Date 处理）规划中。
