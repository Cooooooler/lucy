# 工具

## hashTag

生成 Redis Cluster 散列槽标签：把 key 包进 `{}`，使共享同一标签的相关 key 路由到同一槽位。

```ts
import { hashTag } from '@coool/redis-nest';

hashTag('user:123'); // '{user:123}'
```

Cluster 下将共享标签的 key 归入同一槽，便于事务 / 批量操作的槽位一致性：

```ts
await this.redis.set(`user:${hashTag('123')}:profile`, 'alice');
await this.redis.set(`user:${hashTag('123')}:sessions`, '...');
// 两个 key 都含 {123}，落在同一槽
```

## pipeline

`RedisService.pipeline()` 返回底层 ioredis pipeline，可链式追加命令后 `exec()` 批量执行，减少 RTT：

```ts
const pipeline = this.redis.pipeline();
pipeline.set('a', '1');
pipeline.set('b', '2');
const results = await pipeline.exec(); // [[null, 'OK'], [null, 'OK']]
```

> 与 `raw` 一致，pipeline 的 key 不自动加前缀（需自行处理命名空间）。
