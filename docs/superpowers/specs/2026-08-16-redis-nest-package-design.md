# @coool/redis-nest 设计文档

- **日期**：2026-08-16
- **状态**：已批准
- **范围**：档位 A（轻量封装）——连接管理、序列化、DI、多数据源、统一异常、简单工具
- **明确不做**：注解缓存、分布式锁、分布式组件、多实例缓存层

## 背景与目标

backend 现有 Redis 实现（`apps/backend/src/redis/`）是一个内联薄封装：`RedisModule`（`@Global`）、`RedisService`（get/set/del/exists）、`DenylistService`（RedisBloom 令牌撤销）。连接参数直接从 `@nestjs/config` 读取，无统一序列化、无统一异常、无多数据源支持，且不可复用。

目标：把通用 Redis 封装抽取为**可发布的开源 NestJS 库** `@coool/redis-nest`，解决连接池配置坑、序列化混乱、DI 体验差、原始异常满天飞。

## 决策记录

1. **可发布开源库**（非私有 workspace 包）——peerDependencies + 双构建（ESM/CJS）+ README + 版本发布。
2. **DenylistService 留在 backend**——RedisBloom 逻辑太业务化，不进通用库。但它目前注入裸 `ioredis.Redis`（`REDIS_CLIENT` token），因此**库必须继续暴露原始 client**。
3. **`forFeature` 同时支持命名客户端 + 命名空间（key 前缀）**——多连接与同连接 key 隔离都要。
4. **命名空间用固定前缀**——`forFeature({ namespace })` 声明时固定，运行时不可动态换前缀（后续再深入）。
5. **包名 `@coool/redis-nest`**——scope 占位，可改。
6. **步进式交付**——分 6 步，每步独立可验证，最终实现完整档位 A。

## 架构

### 1. 包身份

- 目录 `packages/redis`
- 包名 `@coool/redis-nest`
- `peerDependencies`: `@nestjs/common`、`@nestjs/core`、`ioredis`；`devDependencies` 装同版本供测试
- 全仓 ESM 约定下用 tsup 双构建：**ESM + CJS**（`exports` map 同时给 `import` 与 `require`，`types` 指向 `dist/index.d.ts`）

### 2. 连接模块 `RedisModule`

```ts
RedisModule.forRoot(RedisOptions)                 // 同步连接配置
RedisModule.forRootAsync({
  inject, useFactory,
})                                               // 异步，可读 @nestjs/config
RedisModule.forFeature({ name?, namespace? })     // 命名客户端 + key 前缀
```

- `RedisOptions` 连接模式三选一：
  - 单机：`host` / `port`
  - 哨兵：`sentinels`（`{host,port}[]`）+ `name`
  - Cluster：`clusterNodes`（`{host,port}[]`）
- 内置**生产默认参数**：`retryStrategy`、`maxRetriesPerRequest`、`connectTimeout`、`lazyConnect`、`keepAlive`
- `forRoot` 注册为默认 `RedisService`；`forFeature` 产生命名实例

### 3. 序列化层

- 默认 `JSON` 序列化器
- 支持自定义序列化器（实现 `RedisSerializer` 接口，`serialize`/`deserialize`）可替换
- 自动处理 `Date`（存 ISO 字符串、读回 `Date`）
- API 分两层：
  - `get(key)` / `set(key, value, ttl?)` —— 原始字符串，不序列化
  - `getJson(key)` / `setJson(key, value, ttl?)` —— 走序列化层

### 4. DI

- 默认注入 `RedisService` 即可用：`get/set/del/exists` + `getJson/setJson` + `client` 透传
- 命名空间实例自动给 key 拼前缀
- 命名客户端通过独立 token 区分注入
- **统一异常**：`RedisService` 捕获 ioredis 错误，包装为 `RedisException`（库内独立异常类，继承 `Error`，含 `code`；不依赖 backend 的 `BusinessException`）

### 5. 工具

- `hashTag(key)`：生成 `{key}` 散列槽标签
- `RedisService.pipeline(...)`：ioredis pipeline 封装

### 6. 测试与发布

- 单测 + 集成测试（`testcontainers` 起 redis；如无 docker 则 mock ioredis）
- README（安装、用法、配置项、API）
- `prepublishOnly` 跑 `build` + `test`

## 步进交付顺序

1. **包骨架**：`packages/redis` 目录、tsup 双构建、peer 依赖、类型导出、turbo 接入
2. **连接 + DI + 异常**：`forRoot/forRootAsync`（单机/哨兵/Cluster + 默认参数）、`RedisService`、统一异常包装
3. **序列化层**：默认 JSON、自定义序列化器、自动 Date、`getJson/setJson`
4. **forFeature**：命名客户端 + 命名空间固定前缀 + DI token 拆分
5. **工具 + 发布准备**：`hashTag` + pipeline + README + 集成测试
6. **（可选后续 PR）** backend 狗食化迁移

## 开放项

- 包名 scope（暂定 `@coool`，可改）
- 集成测试是否走 testcontainers 取决于本地 docker 可用性
