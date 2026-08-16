# 序列化（规划中）

::: warning 尚未实现本功能属于实现计划的**第 3 步**，当前未发布。以下为规划方向，API 可能调整。:::

规划能力：

- 默认 `JSON` 序列化器。
- 支持自定义序列化器（实现 `RedisSerializer`，`serialize`/`deserialize`）可替换。
- 自动处理 `Date`（存 ISO 字符串、读回 `Date`）。
- 新增 `getJson(key)` / `setJson(key, value, ttl?)` 两个方法。

```ts
// 规划中的用法示意
await this.redis.setJson('user:1', { name: 'Alice', at: new Date() });
const user = await this.redis.getJson('user:1');
```

详见实现计划 `docs/superpowers/plans/` 中对应阶段。
