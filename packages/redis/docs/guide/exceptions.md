# 异常处理

库把 ioredis 底层错误统一包装为 `RedisException`，携带稳定的 `code` 便于上层分类处理。

## RedisException

```ts
class RedisException extends Error {
  readonly code: string; // 默认 'REDIS_ERROR'
}
```

- 继承 `Error`，`name` 为 `RedisException`。
- `code` 默认 `REDIS_ERROR`，构造时可自定义。
- 保留 `cause` 指向原始 ioredis 错误，便于排查。

## 捕获

`RedisService` 的所有方法都会把 ioredis 错误包装为 `RedisException` 后抛出：

```ts
import { RedisException } from '@coool/redis-nest';

try {
  await this.redis.get('key');
} catch (error) {
  if (error instanceof RedisException) {
    // error.code 分类处理
  }
}
```

> 注意：经 `raw` 直接操作底层 client 的命令不经过异常包装，由调用方自行处理原生 ioredis 错误。
