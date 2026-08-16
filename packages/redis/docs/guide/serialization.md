# 序列化

`setJson` / `getJson` 走统一的序列化层：默认 `JSON` 序列化器，自动处理 `Date`；也可传入自定义序列化器替换。

## 用法

```ts
await this.redis.setJson('user:1', { name: 'Alice', at: new Date() }, 60);
const user = await this.redis.getJson<{ name: string; at: Date }>('user:1');
// user.at 自动还原为 Date 实例
```

- `setJson(key, value, ttl?)`：value 经序列化器转字符串后写入；传 `ttlSeconds` 时附加 `EX` 过期。
- `getJson<T>(key)`：读回并经序列化器还原；key 不存在返回 `null`。

## 默认序列化器

`defaultJsonSerializer` 基于 `JSON.stringify` / `JSON.parse`：

- 序列化：`Date` 转为 ISO 字符串存储。
- 反序列化：严格 ISO-8601 日期字符串还原为 `Date`（`isIsoDateString` 判定）。

```ts
import { defaultJsonSerializer, isIsoDateString } from '@coool/redis-nest';

isIsoDateString('2026-08-16T10:00:00.000Z'); // true
isIsoDateString('hello'); // false
```

## 自定义序列化器

实现 `RedisSerializer` 接口，经 `forRoot` / `forRootAsync` 的 `serializer` 选项替换：

```ts
import { RedisModule, type RedisSerializer } from '@coool/redis-nest';

// 自定义序列化器：例如用 MessagePack 或自定义格式
const msgpackSerializer: RedisSerializer = {
  serialize(value: unknown): string {
    // 返回字符串
    return JSON.stringify(value);
  },
  deserialize(text: string): unknown {
    // 还原
    return JSON.parse(text);
  },
};

RedisModule.forRoot({
  type: 'standalone',
  serializer: msgpackSerializer,
});
```

> `RedisService` 的底层经 `REDIS_SERIALIZER` token 注入；也可在消费模块自行覆盖该 token 换序列化器。
