# 用户登录模块设计

- 日期：2026-08-02
- 状态：待审查（spec 自检完成前）
- 涉及：`apps/backend`（NestJS 11）、`apps/frontend`（Umi Max）、`packages/shared`

## 1. 背景与目标

为 lucy monorepo 后端实现完整的用户注册/登录/会话管理，支撑前端 Umi Max 鉴权与路由守卫。复用已就绪的 PostgreSQL（TypeORM）与 Redis（Docker）。

核心约束（用户指定）：

1. 密码哈希用内置 `node:crypto`（不用 bcrypt）。
2. 登出必须**立即失效**，无任何过期窗口。
3. 会话黑名单采用**布隆过滤器**，项目初期即用 RedisBloom 完整方案。

## 2. 范围

**包含**：注册、密码登录、令牌刷新、登出（立即失效）、获取当前用户、JWT 守卫、Redis 会话存储、布隆过滤器黑名单、前端集成（服务层/拦截器/登录态）。

**不包含**（后续里程碑）：OAuth/第三方登录、邮箱验证、找回密码、多因素认证、RBAC 权限矩阵。

## 3. 认证方案（决策：JWT 双令牌）

| 方案 | 机制 | 结论 |
| --- | --- | --- |
| A. JWT 双令牌 | access JWT（短时效）+ opaque refresh token（Redis 存储，长时效） | **采用** |
| B. 纯 Session | cookie + Redis session | 未采用：无状态性差、cookie 依赖重 |
| C. 单 JWT + 黑名单 | 单长时效 JWT，登出进黑名单 | 未采用：TTL 与吊销冲突 |

采用 A，配合布隆过滤器实现 access token 即时吊销：

- **access token**：JWT，TTL 15min，载荷 `{ sub: userId, jti: 随机ID, exp }`，无状态，走 `Authorization: Bearer`。
- **refresh token**：`crypto.randomBytes(32)` base64url 不透明串，Redis 存储，TTL 7 天。
- **登出立即失效**：
  1. `DEL auth:refresh:{userId}:{jti}` → refresh 即刻作废；
  2. `BF.ADD` 将 access 的 `jti` 写入黑名单 → 后续请求 `BF.EXISTS` 命中即 401。

## 4. 技术栈决策

| 关注点 | 选择 | 说明 |
| --- | --- | --- |
| 密码哈希 | `node:crypto` scrypt | `N=16384, r=8, p=1`，盐 `randomBytes(16)`；存储格式 `scrypt:N:r:p:盐:哈希`（base64），参数随串保存便于升级；校验用 `crypto.timingSafeEqual` 恒时比较 |
| Redis 客户端 | `ioredis` + 手写全局 `RedisModule` | `forRootAsync` 读 `REDIS_HOST/PORT`，`@Global()` 导出 `Redis` provider；模块命令用 `client.call('BF.ADD', ...)` |
| 布隆过滤器 | RedisBloom 模块 | 镜像换为 `redis/redis-stack-server:latest`；命令 `BF.RESERVE / BF.ADD / BF.EXISTS` |
| JWT | `@nestjs/jwt` | 异步注册，secret 走 `.env` |
| 守卫 | `@nestjs/passport` + `passport-jwt` | 生态成熟，便于后续扩展 OAuth |

## 5. 数据模型（TypeORM 迁移）

`users` 表（迁移文件 `src/db/migrations/<ts>-CreateUsers.ts`）：

| 列              | 类型            | 约束                                |
| --------------- | --------------- | ----------------------------------- |
| `id`            | bigint identity | PK                                  |
| `username`      | varchar(50)     | NOT NULL UNIQUE                     |
| `email`         | varchar(255)    | NOT NULL UNIQUE                     |
| `password_hash` | varchar(255)    | NOT NULL                            |
| `nickname`      | varchar(50)     | NULL                                |
| `status`        | smallint        | NOT NULL DEFAULT 1（1=正常 0=禁用） |
| `created_at`    | timestamptz     | NOT NULL DEFAULT now()              |
| `updated_at`    | timestamptz     | NOT NULL DEFAULT now()              |
| `deleted_at`    | timestamptz     | NULL（软删除）                      |

约定：`username` 与 `email` 均唯一；`password_hash` 永不返回前端。

## 6. 后端模块结构

```
src/
  auth/
    auth.module.ts            # 引入 JwtModule、RedisModule、UsersModule
    auth.controller.ts        # /auth/*
    auth.service.ts           # 注册/登录/刷新/登出/校验
    jwt.strategy.ts           # passport-jwt 策略（校验签名 + BF.EXISTS 黑名单）
    dto/register.dto.ts       # class-validator：username/email/password/nickname?
    dto/login.dto.ts          # account(username|email)/password
    dto/refresh.dto.ts
  users/
    users.module.ts
    users.entity.ts           # @Entity('users')
    users.service.ts          # 按 username/email/id 查询、密码哈希/比对
  redis/
    redis.module.ts           # @Global() ioredis provider
    redis.service.ts          # 封装 get/set/del + BloomFilter 操作
  common/guards/
    jwt-auth.guard.ts
  common/decorators/
    public.decorator.ts       # @Public() 跳过全局守卫
    current-user.decorator.ts
```

统一响应沿用 `packages/shared` 的 `ApiResponse<T> = { code, message, data }`。

## 7. 令牌生命周期

- **注册**（`@Public`）：校验 username/email 唯一 → scrypt 哈希 → 建用户 → 返回 `user`（不含 hash）。
- **登录**（`@Public`）：`account` 自动识别 username 或 email → 查用户 → scrypt 校验 → 检查 status → 签发 access + 生成 refresh 并写入 Redis → 返回 `{ accessToken, refreshToken, user }`，refresh 同时写 httpOnly cookie。
- **刷新**：校验 refresh（Redis 存在）→ 签发新 access + 轮换新 refresh（删旧存新）。
- **登出**（需登录）：`DEL` refresh key + `BF.ADD` 当前 access `jti`。
- **鉴权**：JwtAuthGuard 验签 + `BF.EXISTS`（cur 与 prev 均查），命中即 401。

## 8. 布隆过滤器（RedisBloom，双代轮换）

| 操作 | 命令 | 说明 |
| --- | --- | --- |
| 初始化 | `BF.RESERVE auth:denylist:cur 0.01 100000` | 误报率 1%，容量 10w |
| 登出写入 | `BF.ADD auth:denylist:cur <jti>` | 写入当前代 |
| 请求校验 | `BF.EXISTS auth:denylist:cur <jti>`、`auth:denylist:prev` | 任一代命中即拒绝 |
| 轮换 | 每 access TTL 窗口执行一次 | `prev` 丢弃、`cur`→`prev`、`RESERVE` 新 `cur` |

要点：位图无法删除，双代轮换保证内存恒定；误报方向安全（只会误拒合法请求，不会放行非法令牌）。

轮换触发：**惰性轮换**。Redis 存时间戳键 `auth:denylist:gen-ts`，请求鉴权时若距上次轮换已过一个 access TTL 窗口则触发：丢弃 `prev`、`cur`→`prev`、`RESERVE` 新 `cur`。多实例并发用 `SET NX EX` 加锁保证单点执行。

## 9. API 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | body: `username`、`email`、`password`、`nickname?` |
| POST | `/auth/login` | Public | body: `account`（username 或 email）、`password` |
| POST | `/auth/refresh` | Public（读 cookie/body） | body: `refreshToken?` |
| POST | `/auth/logout` | Auth | 吊销当前会话 |
| GET | `/auth/me` | Auth | 当前用户信息 |

响应统一 `ApiResponse<T>`；`login` 的 `data` 含 `accessToken`、`refreshToken`、`user`，refresh token 同时经 Set-Cookie（httpOnly, SameSite=Lax）下发。

## 10. 错误码

| code  | 含义                                     |
| ----- | ---------------------------------------- |
| 0     | 成功                                     |
| 40101 | 未登录 / 令牌失效                        |
| 40102 | 用户名或密码错误（统一提示，防账号枚举） |
| 40103 | 账号已禁用                               |
| 40901 | 用户名已存在                             |
| 40902 | 邮箱已存在                               |

## 11. 安全要点

- scrypt 哈希 + `timingSafeEqual`；成本参数随串存储。
- refresh token httpOnly cookie（SameSite=Lax）+ 响应体双载体。
- 登录失败统一提示，不区分「用户名不存在」与「密码错误」。
- `JWT_SECRET`、`REDIS_*`、scrypt 参数走 `.env`，`.env.example` 同步维护。
- 可选增强（本期不实现）：refresh token 重用检测（检测到旧 token 复用即吊销该用户全部会话）。

## 12. 前端集成（Umi Max）

- `src/services/auth/`：注册/登录/刷新 API + `typings.d.ts`。
- `src/app.ts`：request 拦截器统一带 access token，401 静默调 `/auth/refresh` 后重放一次。
- `src/models/`：`user` 模型存当前用户，接入 `getInitialState`。
- `src/access.ts`：登录态接入权限判断。
- `/login` 页 + 未登录重定向守卫。

## 13. 测试策略

- 单元：`auth.service` 密码哈希/比对、令牌签发/刷新/登出逻辑；`users.service` 查询与唯一性。
- e2e（连本地 PG + Redis 测试库）：注册 → 登录 → `/auth/me` → 刷新 → 登出后 access/refresh 均立即失效。
- 密码哈希与 Redis 真实路径，不 mock（本地已具备 PG + Redis）。

## 14. 新增环境变量

`REDIS_HOST=127.0.0.1`、`REDIS_PORT=6379`、`JWT_SECRET=<随机>`、`JWT_EXPIRES_IN=15m`、`REFRESH_TTL_SECONDS=604800`、`BLOOM_ERROR_RATE=0.01`、`BLOOM_CAPACITY=100000`。
