# 路线图

库按 6 步渐进实现。当前进度以分支 `feat/redis-package` 为准。

## 步骤状态

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 包骨架（tsup 双构建 ESM+CJS、peer 依赖、turbo 接入） | ✅ 已完成 |
| 2 | 连接模块 + DI + 统一异常（forRoot/forRootAsync、RedisService、RedisException） | ✅ 已完成 |
| 3 | 序列化层（默认 JSON、自定义序列化器、自动 Date、getJson/setJson） | ✅ 已完成 |
| 4 | forFeature（命名客户端 + key 前缀命名空间） | ✅ 已完成 |
| 5 | 工具（hashTag、pipeline）+ 集成测试 | ✅ 已完成 |
| 6 | backend 狗食化迁移（可选后续 PR） | ⏳ 规划中 |

## 当前可用 API

- `RedisModule.forRoot(options)` / `forRootAsync({ imports, inject, useFactory })`
- `RedisModule.forFeature({ name?, namespace?, options? })`
- `RedisService`：`get` / `set` / `del` / `exists` / `setJson` / `getJson` / `pipeline` / `raw`
- `RedisException` + `toRedisException`
- 序列化：`defaultJsonSerializer`、`isIsoDateString`、`RedisSerializer`
- 工具：`hashTag`
- DI token：`REDIS_CLIENT` / `REDIS_SERIALIZER` / `getNamedClientToken(name)`
- 配置：`RedisModuleOptions`（standalone / sentinel / cluster）、`DEFAULT_OPTIONS`、`defaultRetryStrategy`、`normalizeOptions`、`createClient`

## 明确不做

注解缓存、分布式锁、分布式组件不在档位 A 范围内。
