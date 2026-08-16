# 多数据源（forFeature，规划中）

::: warning 尚未实现本功能属于实现计划的**第 4 步**，当前未发布。以下为规划方向，API 可能调整。:::

`forFeature` 同时支持**命名客户端**与**命名空间（key 前缀）**：

```ts
// 规划中的用法示意
@Module({
  imports: [
    RedisModule.forFeature({ name: 'cache' }),
    RedisModule.forFeature({ namespace: 'auth' }),
  ],
})
export class FeatureModule {}
```

规划能力：

- 命名客户端：创建独立连接，按名字注入。
- 命名空间：共享连接但自动给 key 加固定前缀（当前决定用固定前缀，运行时动态前缀后续再深入）。
- DI token 拆分，支持多实例/多隔离场景。

详见实现计划 `docs/superpowers/plans/` 中对应阶段。
