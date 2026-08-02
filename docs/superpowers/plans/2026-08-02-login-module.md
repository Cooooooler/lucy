# 用户登录模块（后端）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 `apps/backend` 实现注册/登录/刷新/登出/当前用户五接口，access token 登出立即失效（RedisBloom 混合布隆黑名单），refresh token 存 Redis。

**架构：** JWT 双令牌。access JWT（15min，载荷 `{ sub, jti }`）无状态；refresh 不透明串存 Redis（7d）。登出时 `DEL` refresh key + 将 access `jti` 写入布隆（`BF.ADD`）+ 精确确认 key（`SET auth:denied:{jti} EX`）；鉴权时 `BF.EXISTS` 命中再精确复查，消除误报。布隆双代轮换 + TTL 对齐。密码哈希用 `node:crypto` scrypt。

**技术栈：** NestJS 11、TypeORM 1.x + PostgreSQL、`ioredis` + RedisBloom（`redis/redis-stack-server`）、`@nestjs/jwt`、`@nestjs/passport` + `passport-jwt`、`class-validator`。

**设计依据：** `docs/superpowers/specs/2026-08-02-login-module-design.md`

---

## 文件结构

**新建（backend）：**

| 文件 | 职责 |
| --- | --- |
| `apps/backend/src/common/common.module.ts` | 全局提供：响应拦截器、异常过滤器、ValidationPipe |
| `apps/backend/src/common/interceptors/api-response.interceptor.ts` | 成功响应包裹为 `ApiResponse` |
| `apps/backend/src/common/filters/all-exceptions.filter.ts` | 异常映射为 `ApiResponse`（含业务码） |
| `apps/backend/src/common/exceptions/business.exception.ts` | 携带业务码的异常基类 |
| `apps/backend/src/common/decorators/public.decorator.ts` | `@Public()` 跳过全局 JWT 守卫 |
| `apps/backend/src/common/decorators/current-user.decorator.ts` | `@CurrentUser()` 注入当前用户 |
| `apps/backend/src/redis/redis.constants.ts` | `REDIS_CLIENT` 注入 token |
| `apps/backend/src/redis/redis.module.ts` | `@Global()` ioredis provider + RedisService |
| `apps/backend/src/redis/redis.service.ts` | get/set/del/exists 封装 |
| `apps/backend/src/redis/denylist.service.ts` | 布隆混合黑名单：add/isDenied/ensureInitialized/轮换 |
| `apps/backend/src/password/password.service.ts` | scrypt 哈希/校验 |
| `apps/backend/src/password/password.module.ts` | 导出 PasswordService |
| `apps/backend/src/users/user.entity.ts` | `users` 表实体 |
| `apps/backend/src/users/users.service.ts` | 查询/创建用户（唯一校验） |
| `apps/backend/src/users/users.module.ts` | forFeature([User]) + UsersService |
| `apps/backend/src/auth/auth.module.ts` | JwtModule/PassportModule + 全局 JWT 守卫 |
| `apps/backend/src/auth/auth.service.ts` | 注册/登录/刷新/登出/me |
| `apps/backend/src/auth/auth.controller.ts` | `/auth/*` 路由 + cookie 写入 |
| `apps/backend/src/auth/jwt.strategy.ts` | passport-jwt 策略 + 布隆黑名单校验 |
| `apps/backend/src/auth/jwt-auth.guard.ts` | 全局守卫（`@Public()` 可跳过） |
| `apps/backend/src/auth/dto/register.dto.ts` | 注册 DTO |
| `apps/backend/src/auth/dto/login.dto.ts` | 登录 DTO |
| `apps/backend/src/auth/dto/refresh.dto.ts` | 刷新 DTO |
| `apps/backend/src/db/migrations/<ts>-CreateUsers.ts` | 建表迁移（generate 生成） |
| `apps/backend/test/auth.e2e-spec.ts` | 全链路 e2e |

**修改（backend）：**

| 文件 | 变更 |
| --- | --- |
| `docker-compose.yml` | redis 镜像换 `redis/redis-stack-server` |
| `apps/backend/package.json` | 加依赖与 e2e 用 `test:e2e` 已有 |
| `apps/backend/.env` / `.env.example` | 加 `REDIS_*`、`JWT_*`、`BLOOM_*` |
| `apps/backend/src/main.ts` | 挂 `cookieParser()` |
| `apps/backend/src/app.module.ts` | 引入 CommonModule、RedisModule、PasswordModule、UsersModule、AuthModule |
| `packages/shared/src/index.ts` | 加 `ErrorCode` 常量 |
| `apps/backend/test/app.e2e-spec.ts` | 适配 `ApiResponse` 包裹 |

**修改（前端，Phase 2 独立计划）：** 见文末「后续计划」。

---

## 任务 1：切换 Redis 镜像并验证 RedisBloom

**文件：** 修改 `docker-compose.yml`

- [ ] **步骤 1：换镜像并重启**

```yaml
# docker-compose.yml 的 redis 服务
image: redis/redis-stack-server:latest
```

```bash
cd F:/project/lucy
docker compose up -d redis
```

- [ ] **步骤 2：验证 BF 命令可用**

```bash
docker exec lucy-redis redis-cli BF.RESERVE bf:smoke 0.01 1000
docker exec lucy-redis redis-cli BF.ADD bf:smoke abc
docker exec lucy-redis redis-cli BF.EXISTS bf:smoke abc    # 1
docker exec lucy-redis redis-cli DEL bf:smoke
```

预期：BF.ADD 返回 1，BF.EXISTS 返回 1。若 BF.RESERVE 报 `unknown command`，说明镜像不含模块，改用 `redislabs/rebloom:latest`。

- [ ] **步骤 3：Commit**

```bash
git add docker-compose.yml
git commit -m "chore: redis 镜像切换为 redis-stack-server 以启用 RedisBloom"
```

---

## 任务 2：安装后端依赖

**文件：** 修改 `apps/backend/package.json`（由命令更新）

- [ ] **步骤 1：安装**

```bash
cd F:/project/lucy
pnpm --filter @lucy/backend add @nestjs/jwt @nestjs/passport passport passport-jwt ioredis cookie-parser class-validator class-transformer
pnpm --filter @lucy/backend add -D @types/passport-jwt @types/cookie-parser
```

- [ ] **步骤 2：确认版本**

```bash
pnpm --filter @lucy/backend list @nestjs/jwt ioredis class-validator --depth 0
```

预期：`@nestjs/jwt@^11`、`ioredis@^5`、`class-validator@^0.14`。若 `@nestjs/jwt` 解析到其他主版本，改显式 `@nestjs/jwt@^11`。

- [ ] **步骤 3：Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): 安装认证依赖 jwt/passport/ioredis/validator"
```

---

## 任务 3：环境变量 + 统一响应/异常基础设施

**文件：** 新建 `common/*` 5 个文件、修改 `apps/backend/.env`、`.env.example`、`packages/shared/src/index.ts`、`apps/backend/src/app.module.ts`、`apps/backend/test/app.e2e-spec.ts`

- [ ] **步骤 1：shared 加错误码常量**

修改 `packages/shared/src/index.ts`，在 `ApiResponse` 后追加：

```ts
export const ErrorCode = {
  OK: 0,
  UNAUTHORIZED: 40101,
  INVALID_CREDENTIALS: 40102,
  ACCOUNT_DISABLED: 40103,
  USERNAME_TAKEN: 40901,
  EMAIL_TAKEN: 40902,
  INTERNAL: 50000,
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
```

- [ ] **步骤 2：`.env` / `.env.example` 追加**

```
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=<生成随机串，如 openssl rand -hex 32>
JWT_EXPIRES_IN=15m
REFRESH_TTL_SECONDS=604800
BLOOM_ERROR_RATE=0.01
BLOOM_CAPACITY=1000000
BLOOM_ROTATION_SECONDS=900
```

- [ ] **步骤 3：新建 CommonModule 及三个公共文件**

`apps/backend/src/common/exceptions/business.exception.ts`：

```ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    code: number,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}
```

`apps/backend/src/common/interceptors/api-response.interceptor.ts`：

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(map((data) => ({ code: 0, message: 'ok', data })));
  }
}
```

`apps/backend/src/common/filters/all-exceptions.filter.ts`：

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ErrorCode } from '@lucy/shared';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as
        { code?: number; message?: string | string[] } | string;
      const code = typeof body === 'object' && body.code ? body.code : status;
      const message =
        typeof body === 'object'
          ? Array.isArray(body.message)
            ? body.message[0]
            : (body.message ?? exception.message)
          : body;
      return res.status(status).json({ code, message, data: null });
    }
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({
        code: ErrorCode.INTERNAL,
        message: '服务器内部错误',
        data: null,
      });
  }
}
```

`apps/backend/src/common/common.module.ts`：

```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor';

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class CommonModule {}
```

- [ ] **步骤 4：AppModule 引入 CommonModule**

`apps/backend/src/app.module.ts` 的 `imports` 数组开头加 `CommonModule`（在 ConfigModule 之后）：

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  CommonModule,
  TypeOrmModule.forRootAsync({
    // ...现有配置不变
  }),
],
```

- [ ] **步骤 5：更新既有 e2e 断言适配 ApiResponse**

`apps/backend/test/app.e2e-spec.ts`：把对 `GET /` 的断言从 `'Hello World!'` 改为

```ts
expect(res.body).toEqual({ code: 0, message: 'ok', data: 'Hello World!' });
```

- [ ] **步骤 6：运行验证**

```bash
pnpm --filter @lucy/backend typecheck
pnpm --filter @lucy/backend build
pnpm --filter @lucy/backend test
```

预期：typecheck/build 通过，`src/app.controller.spec.ts` 仍 PASS（它测的是 service 层，不受影响）。

- [ ] **步骤 7：Commit**

```bash
git add packages/shared/src/index.ts apps/backend/src/common apps/backend/src/app.module.ts apps/backend/.env apps/backend/.env.example apps/backend/test/app.e2e-spec.ts
git commit -m "feat(backend): 统一 ApiResponse 响应与异常映射及错误码"
```

---

## 任务 4：RedisModule + RedisService

**文件：** 新建 `apps/backend/src/redis/redis.constants.ts`、`redis.module.ts`、`redis.service.ts`

- [ ] **步骤 1：编写失败测试**

`apps/backend/src/redis/redis.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: new Redis({
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: Number(process.env.REDIS_PORT ?? 6379),
          }),
        },
        RedisService,
      ],
    }).compile();
    service = module.get(RedisService);
  });

  afterAll(async () => {
    const client = (service as unknown as { client: Redis }).client;
    await client.flushdb();
    client.disconnect();
  });

  it('set/get 往返', async () => {
    await service.set('spec:key', 'v', 60);
    await expect(service.get('spec:key')).resolves.toBe('v');
  });

  it('del 后 exists 为 false', async () => {
    await service.set('spec:key2', 'v');
    await service.del('spec:key2');
    await expect(service.exists('spec:key2')).resolves.toBe(false);
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/redis/redis.service.spec.ts` 预期：报错 `Cannot find module './redis.service'`（文件不存在）。

- [ ] **步骤 3：实现**

`apps/backend/src/redis/redis.constants.ts`：

```ts
export const REDIS_CLIENT = 'REDIS_CLIENT';
```

`apps/backend/src/redis/redis.module.ts`：

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: config.get<number>('REDIS_PORT', 6379),
        }),
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
```

`apps/backend/src/redis/redis.service.ts`：

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get client(): Redis {
    return this.redis;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<number> {
    return this.redis.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }
}
```

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/redis/redis.service.spec.ts` 预期：PASS。注意需本地 Redis（127.0.0.1:6379）运行中。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/redis apps/backend/src/app.module.ts
git commit -m "feat(backend): 全局 RedisModule 与 RedisService"
```

---

## 任务 5：PasswordService（node:crypto scrypt）

**文件：** 新建 `apps/backend/src/password/password.service.ts`、`password.module.ts`、`password.service.spec.ts`

- [ ] **步骤 1：编写失败测试**

`apps/backend/src/password/password.service.spec.ts`：

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hash 后可 verify 通过', async () => {
    const hash = await service.hash('P@ssw0rd!');
    await expect(service.verify('P@ssw0rd!', hash)).resolves.toBe(true);
  });

  it('错误密码 verify 失败', async () => {
    const hash = await service.hash('P@ssw0rd!');
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });

  it('hash 格式含参数前缀', async () => {
    const hash = await service.hash('P@ssw0rd!');
    expect(hash.startsWith('scrypt:16384:8:1:')).toBe(true);
  });

  it('非法格式返回 false', async () => {
    await expect(service.verify('x', 'not-a-hash')).resolves.toBe(false);
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/password/password.service.spec.ts` 预期：报错 `Cannot find module './password.service'`。

- [ ] **步骤 3：实现**

`apps/backend/src/password/password.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p, keylen } = DEFAULT_PARAMS;
    const derived = await scrypt(password, salt, keylen, { N, r, p });
    return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${derived.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  }
}
```

`apps/backend/src/password/password.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { PasswordService } from './password.service';

@Module({
  providers: [PasswordService],
  exports: [PasswordService],
})
export class PasswordModule {}
```

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/password/password.service.spec.ts` 预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/password
git commit -m "feat(backend): node:crypto scrypt 密码哈希服务"
```

---

## 任务 6：User 实体 + users 表迁移

**文件：** 新建 `apps/backend/src/users/user.entity.ts`、`users.module.ts`；生成 `apps/backend/src/db/migrations/<ts>-CreateUsers.ts`

- [ ] **步骤 1：编写实体**

`apps/backend/src/users/user.entity.ts`：

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
@Unique(['username'])
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  nickname: string | null;

  @Column({ type: 'smallint', default: 1 })
  status: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
```

- [ ] **步骤 2：生成迁移**

```bash
cd F:/project/lucy
pnpm --filter @lucy/backend exec typeorm-ts-node-commonjs migration:generate src/db/migrations/CreateUsers -d src/db/data-source.ts
```

- [ ] **步骤 3：人工审查迁移**

打开生成的 `apps/backend/src/db/migrations/<ts>-CreateUsers.ts`，确认 `up` 含：

- `CREATE TABLE "users"`，含 `"id" BIGSERIAL NOT NULL`、`"username" character varying(50) NOT NULL`、`"email" character varying(255) NOT NULL`、`"password_hash" character varying(255) NOT NULL`、`"status" smallint NOT NULL DEFAULT '1'`、`"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`、`"updated_at"` 同、`"deleted_at" TIMESTAMP WITH TIME ZONE`；
- 两个 `ALTER TABLE "users" ADD CONSTRAINT "UQ_..." UNIQUE ("username")` 与 `UNIQUE ("email")`。若有偏差，手改 `up`/`down` 后再执行。

- [ ] **步骤 4：执行迁移**

```bash
pnpm --filter @lucy/backend db:migrate
```

预期：`Migration <ts>-CreateUsers has been executed successfully.`

- [ ] **步骤 5：验证表结构**

```bash
node -e "require('dotenv').config();const{Client}=require('pg');const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});c.connect().then(()=>c.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position\")).then(r=>{console.log(r.rows.map(x=>x.column_name).join(','));return c.end()})"
```

预期输出含：`id,username,email,password_hash,nickname,status,created_at,updated_at,deleted_at`

- [ ] **步骤 6：Commit**

```bash
git add apps/backend/src/users apps/backend/src/db/migrations
git commit -m "feat(backend): User 实体与 users 表迁移"
```

---

## 任务 7：UsersService

**文件：** 新建 `apps/backend/src/users/users.service.ts`、`users.module.ts`、`users.service.spec.ts`；修改 `apps/backend/src/app.module.ts`

- [ ] **步骤 1：编写失败测试**

`apps/backend/src/users/users.service.spec.ts`（mock Repository 与 PasswordService）：

```ts
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { PasswordService } from '../password/password.service';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { BusinessException } from '../common/exceptions/business.exception';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const passwordService = {
    hash: jest.fn().mockResolvedValue('hash'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: PasswordService, useValue: passwordService },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('create 用户名重复抛 40901', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: '1' });
    await expect(
      service.create({ username: 'a', email: 'a@x.com', password: '12345678' }),
    ).rejects.toThrow(BusinessException);
  });

  it('create 成功时调用 hash 并 save', async () => {
    repo.findOneBy.mockResolvedValue(null);
    repo.save.mockResolvedValue({ id: '1' });
    await service.create({
      username: 'a',
      email: 'a@x.com',
      password: '12345678',
    });
    expect(passwordService.hash).toHaveBeenCalledWith('12345678');
    expect(repo.save).toHaveBeenCalled();
  });

  it('findByUsername 委托 repo', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    await expect(service.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ username: 'a' });
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/users/users.service.spec.ts` 预期：`Cannot find module './users.service'`。

- [ ] **步骤 3：实现**

`apps/backend/src/users/users.service.ts`：

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ErrorCode } from '@lucy/shared';
import { QueryFailedError, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { PasswordService } from '../password/password.service';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly passwordService: PasswordService,
  ) {}

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOneBy({ username });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async create(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<User> {
    if (await this.findByUsername(input.username)) {
      throw new BusinessException(
        ErrorCode.USERNAME_TAKEN,
        '用户名已存在',
        HttpStatus.CONFLICT,
      );
    }
    if (await this.findByEmail(input.email)) {
      throw new BusinessException(
        ErrorCode.EMAIL_TAKEN,
        '邮箱已存在',
        HttpStatus.CONFLICT,
      );
    }
    const passwordHash = await this.passwordService.hash(input.password);
    const user = this.repo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      nickname: input.nickname ?? null,
      status: 1,
    });
    try {
      return await this.repo.save(user);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new BusinessException(
          ErrorCode.USERNAME_TAKEN,
          '用户名或邮箱已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
```

`apps/backend/src/users/users.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordModule } from '../password/password.module';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), PasswordModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

修改 `apps/backend/src/app.module.ts`，`imports` 加入 `PasswordModule`、`UsersModule`。

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/users/users.service.spec.ts` 预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/users apps/backend/src/app.module.ts
git commit -m "feat(backend): UsersService 与 users 模块"
```

---

## 任务 8：DenylistService（布隆混合 + 双代轮换）

**文件：** 新建 `apps/backend/src/redis/denylist.service.ts`、`denylist.service.spec.ts`

- [ ] **步骤 1：编写失败测试**

`apps/backend/src/redis/denylist.service.spec.ts`（真实 Redis）：

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { DenylistService } from './denylist.service';

describe('DenylistService', () => {
  let service: DenylistService;
  let client: Redis;

  beforeAll(async () => {
    client = new Redis({ host: '127.0.0.1', port: 6379 });
    const module = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: client },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_EXPIRES_IN: '15m' }),
        },
        DenylistService,
      ],
    }).compile();
    service = module.get(DenylistService);
    await service.ensureInitialized();
  });

  afterAll(async () => {
    await client.del(
      'auth:denylist:cur',
      'auth:denylist:prev',
      'auth:denylist:gen-ts',
      'auth:denylist:lock',
      'auth:denied:spec-jti-1',
      'auth:denied:spec-jti-2',
    );
    client.disconnect();
  });

  it('add 后 isDenied 为 true', async () => {
    await service.add('spec-jti-1');
    await expect(service.isDenied('spec-jti-1')).resolves.toBe(true);
  });

  it('未加入的 jti isDenied 为 false', async () => {
    await expect(service.isDenied('spec-jti-2')).resolves.toBe(false);
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/redis/denylist.service.spec.ts` 预期：`Cannot find module './denylist.service'`。

- [ ] **步骤 3：实现**

`apps/backend/src/redis/denylist.service.ts`：

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class DenylistService {
  private static readonly CUR = 'auth:denylist:cur';
  private static readonly PREV = 'auth:denylist:prev';
  private static readonly GEN_TS = 'auth:denylist:gen-ts';
  private static readonly LOCK = 'auth:denylist:lock';

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private get capacity(): number {
    return this.config.get<number>('BLOOM_CAPACITY', 1000000);
  }
  private get errorRate(): number {
    return this.config.get<number>('BLOOM_ERROR_RATE', 0.01);
  }
  private get rotationSeconds(): number {
    return this.config.get<number>('BLOOM_ROTATION_SECONDS', 900);
  }
  private get accessTtlSeconds(): number {
    const v = this.config.get<string>('JWT_EXPIRES_IN', '15m');
    const m = /^(\d+)([smhd])$/.exec(v);
    if (!m) return 900;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[
      m[2] as 's' | 'm' | 'h' | 'd'
    ];
    return Number(m[1]) * mult;
  }

  async ensureInitialized(): Promise<void> {
    const now = Date.now();
    const ts = await this.redis.get(DenylistService.GEN_TS);
    if (ts && now - Number(ts) < this.rotationSeconds * 1000) return;
    if (
      (await this.redis.set(DenylistService.LOCK, '1', 'EX', 5, 'NX')) !== 'OK'
    )
      return;
    try {
      const ts2 = await this.redis.get(DenylistService.GEN_TS);
      if (ts2 && now - Number(ts2) < this.rotationSeconds * 1000) return;
      await this.rotate();
    } finally {
      await this.redis.del(DenylistService.LOCK);
    }
  }

  async add(jti: string): Promise<void> {
    await this.redis.call('BF.ADD', DenylistService.CUR, jti);
    await this.redis.set(
      `auth:denied:${jti}`,
      '1',
      'EX',
      this.accessTtlSeconds,
    );
  }

  async isDenied(jti: string): Promise<boolean> {
    const inCur =
      (await this.redis.call('BF.EXISTS', DenylistService.CUR, jti)) === 1;
    const inPrev =
      (await this.redis.call('BF.EXISTS', DenylistService.PREV, jti)) === 1;
    if (!inCur && !inPrev) return false;
    return (await this.redis.exists(`auth:denied:${jti}`)) === 1;
  }

  private async rotate(): Promise<void> {
    await this.redis.del(DenylistService.PREV);
    if (await this.redis.exists(DenylistService.CUR)) {
      await this.redis.rename(DenylistService.CUR, DenylistService.PREV);
    }
    await this.redis.call(
      'BF.RESERVE',
      DenylistService.CUR,
      this.errorRate,
      this.capacity,
    );
    await this.redis.set(DenylistService.GEN_TS, String(Date.now()));
  }
}
```

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/redis/denylist.service.spec.ts` 预期：PASS。注意需本地 Redis 且镜像为 redis-stack-server（含 BF 命令）。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/redis/denylist.service.ts apps/backend/src/redis/denylist.service.spec.ts
git commit -m "feat(backend): 布隆混合黑名单 DenylistService 与双代轮换"
```

---

## 任务 9：JwtStrategy + JwtAuthGuard + 装饰器

**文件：** 新建 `apps/backend/src/auth/jwt.strategy.ts`、`jwt-auth.guard.ts`；新建 `apps/backend/src/common/decorators/public.decorator.ts`、`current-user.decorator.ts`

- [ ] **步骤 1：编写失败测试（strategy 黑名单行为）**

`apps/backend/src/auth/jwt.strategy.spec.ts`：

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenylistService } from '../redis/denylist.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('黑名单中的 jti 抛 UnauthorizedException', async () => {
    const denylist = {
      isDenied: jest.fn().mockResolvedValue(true),
    } as unknown as DenylistService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
    );
    await expect(strategy.validate({ sub: '1', jti: 'bad' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('正常 jti 返回 userId 与 jti', async () => {
    const denylist = {
      isDenied: jest.fn().mockResolvedValue(false),
    } as unknown as DenylistService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
    );
    await expect(strategy.validate({ sub: '1', jti: 'ok' })).resolves.toEqual({
      userId: '1',
      jti: 'ok',
    });
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/auth/jwt.strategy.spec.ts` 预期：`Cannot find module './jwt.strategy'`。

- [ ] **步骤 3：实现**

`apps/backend/src/common/decorators/public.decorator.ts`：

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`apps/backend/src/common/decorators/current-user.decorator.ts`：

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  jti: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>().user;
  },
);
```

`apps/backend/src/auth/jwt.strategy.ts`：

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@lucy/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { DenylistService } from '../redis/denylist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: DenylistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub: string;
    jti: string;
  }): Promise<{ userId: string; jti: string }> {
    if (await this.denylist.isDenied(payload.jti)) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: '令牌已失效',
      });
    }
    return { userId: payload.sub, jti: payload.jti };
  }
}
```

`apps/backend/src/auth/jwt-auth.guard.ts`：

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/auth/jwt.strategy.spec.ts` 预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/auth apps/backend/src/common/decorators
git commit -m "feat(backend): JWT 守卫与 Public/CurrentUser 装饰器"
```

---

## 任务 10：AuthService

**文件：** 新建 `apps/backend/src/auth/auth.service.ts`、`auth.service.spec.ts`

- [ ] **步骤 1：编写失败测试（mock 依赖）**

`apps/backend/src/auth/auth.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PasswordService } from '../password/password.service';
import { RedisService } from '../redis/redis.service';
import { DenylistService } from '../redis/denylist.service';
import { AuthService } from './auth.service';
import { User } from '../users/user.entity';
import { BusinessException } from '../common/exceptions/business.exception';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };
  const passwordService = { verify: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const redisService = { set: jest.fn(), del: jest.fn(), get: jest.fn() };
  const denylist = { add: jest.fn() };

  const user: User = {
    id: '1',
    username: 'alice',
    email: 'alice@x.com',
    passwordHash: 'hash',
    nickname: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: DenylistService, useValue: denylist },
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('login 成功返回双令牌', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    const result = await service.login({ account: 'alice', password: 'p' });
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe('alice');
    expect(
      (result.user as { passwordHash?: string }).passwordHash,
    ).toBeUndefined();
  });

  it('login 密码错误抛 40102', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(false);
    await expect(
      service.login({ account: 'alice', password: 'x' }),
    ).rejects.toThrow(BusinessException);
  });

  it('login email 走 findByEmail', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    await service.login({ account: 'alice@x.com', password: 'p' });
    expect(usersService.findByEmail).toHaveBeenCalledWith('alice@x.com');
  });

  it('refresh 无效 token 抛 Unauthorized', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(null);
    await expect(service.refresh('bad')).rejects.toThrow(BusinessException);
  });
});
```

- [ ] **步骤 2：运行确认失败**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/auth/auth.service.spec.ts` 预期：`Cannot find module './auth.service'`。

- [ ] **步骤 3：实现**

`apps/backend/src/auth/auth.service.ts`：

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@lucy/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';
import { PasswordService } from '../password/password.service';
import { DenylistService } from '../redis/denylist.service';
import { RedisService } from '../redis/redis.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

export interface SafeUser {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly denylist: DenylistService,
    private readonly config: ConfigService,
  ) {}

  refreshTtl(): number {
    return this.config.get<number>('REFRESH_TTL_SECONDS', 604800);
  }

  private refreshKey(token: string): string {
    return `auth:refresh:${token}`;
  }

  private toSafeUser(user: User): SafeUser {
    const { id, username, email, nickname, status, createdAt, updatedAt } =
      user;
    return { id, username, email, nickname, status, createdAt, updatedAt };
  }

  async register(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<SafeUser> {
    const user = await this.usersService.create(input);
    return this.toSafeUser(user);
  }

  async login(dto: {
    account: string;
    password: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const user = dto.account.includes('@')
      ? await this.usersService.findByEmail(dto.account)
      : await this.usersService.findByUsername(dto.account);
    if (
      !user ||
      !(await this.passwordService.verify(dto.password, user.passwordHash))
    ) {
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        '用户名或密码错误',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status !== 1) {
      throw new BusinessException(
        ErrorCode.ACCOUNT_DISABLED,
        '账号已禁用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.issueTokens(user);
  }

  private async issueTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(refreshToken),
      user.id,
      this.refreshTtl(),
    );
    return { accessToken, refreshToken, user: this.toSafeUser(user) };
  }

  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const userId = await this.redis.get(this.refreshKey(refreshToken));
    if (!userId) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.usersService.findById(userId);
    if (!user || user.status !== 1) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '账号不可用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.redis.del(this.refreshKey(refreshToken));
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    const newRefreshToken = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(newRefreshToken),
      user.id,
      this.refreshTtl(),
    );
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(
    userId: string,
    jti: string,
    refreshToken?: string,
  ): Promise<void> {
    if (refreshToken) {
      await this.redis.del(this.refreshKey(refreshToken));
    }
    await this.denylist.add(jti);
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '用户不存在',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toSafeUser(user);
  }
}
```

- [ ] **步骤 4：运行确认通过**

运行：`pnpm --filter @lucy/backend test -- --runInBand src/auth/auth.service.spec.ts` 预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.service.spec.ts
git commit -m "feat(backend): AuthService 注册/登录/刷新/登出"
```

---

## 任务 11：AuthController + DTO

**文件：** 新建 `apps/backend/src/auth/dto/register.dto.ts`、`login.dto.ts`、`refresh.dto.ts`、`apps/backend/src/auth/auth.controller.ts`、`apps/backend/src/auth/auth.module.ts`；修改 `apps/backend/src/main.ts`、`apps/backend/src/app.module.ts`

- [ ] **步骤 1：编写 DTO**

`apps/backend/src/auth/dto/register.dto.ts`：

```ts
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 72)
  password: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;
}
```

`apps/backend/src/auth/dto/login.dto.ts`：

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  account: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
```

`apps/backend/src/auth/dto/refresh.dto.ts`：

```ts
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
```

- [ ] **步骤 2：实现 Controller**

`apps/backend/src/auth/auth.controller.ts`：

```ts
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService, SafeUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_COOKIE = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<SafeUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) {
      return this.authService.throwMissingRefresh();
    }
    const tokens = await this.authService.refresh(token);
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @Post('logout')
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    await this.authService.logout(user.userId, user.jti, refreshToken);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload): Promise<SafeUser> {
    return this.authService.me(user.userId);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, this.cookieOptions());
  }

  private cookieOptions(): Record<string, unknown> {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: this.authService.refreshTtl() * 1000,
    };
  }
}
```

> `throwMissingRefresh()` 需在 `AuthService` 加一个抛 `BusinessException(ErrorCode.UNAUTHORIZED, '缺少刷新令牌', HttpStatus.UNAUTHORIZED)` 的方法（见步骤 3）。

- [ ] **步骤 3：AuthService 补充 `throwMissingRefresh`**

在 `apps/backend/src/auth/auth.service.ts` 末尾追加：

```ts
  throwMissingRefresh(): never {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '缺少刷新令牌',
      HttpStatus.UNAUTHORIZED,
    );
  }
```

- [ ] **步骤 4：AuthModule**

`apps/backend/src/auth/auth.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
```

- [ ] **步骤 5：接线 main.ts 与 AppModule**

`apps/backend/src/main.ts` 加 cookie-parser（在 `NestFactory.create` 之后）：

```ts
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3000);
}
```

`apps/backend/src/app.module.ts` 的 `imports` 追加 `RedisModule`、`AuthModule`（RedisModule 为 `@Global()`，先于 AuthModule 声明即可）。

- [ ] **步骤 6：运行验证**

```bash
pnpm --filter @lucy/backend typecheck
pnpm --filter @lucy/backend build
pnpm --filter @lucy/backend test
```

预期：全部通过（含前序 spec）。

- [ ] **步骤 7：Commit**

```bash
git add apps/backend/src/auth apps/backend/src/main.ts apps/backend/src/app.module.ts
git commit -m "feat(backend): auth 控制器与 DTO 及全局守卫接线"
```

---

## 任务 12：e2e 全链路测试

**文件：** 新建 `apps/backend/test/auth.e2e-spec.ts`；前置准备 `lucy_test` 库

- [ ] **步骤 1：创建测试库并迁移**

```bash
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE lucy_test" || true
cd F:/project/lucy
DB_NAME=lucy_test pnpm --filter @lucy/backend db:migrate
```

预期：迁移在 `lucy_test` 上执行成功。

- [ ] **步骤 2：编写 e2e 测试**

`apps/backend/test/auth.e2e-spec.ts`：

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('注册 → 登录 → me → 刷新 → 登出 全链路', async () => {
    const username = `e2e_${suffix}`;
    const email = `${username}@test.com`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username, email, password: 'Password1!' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: username, password: 'Password1!' })
      .expect(201);
    expect(login.body.code).toBe(0);
    const accessToken = login.body.data.accessToken as string;
    const refreshToken = login.body.data.refreshToken as string;

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.data.username).toBe(username);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    expect(refreshed.body.data.accessToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(201);

    // 登出后 access 立即失效
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // 登出后 refresh 立即失效
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});
```

- [ ] **步骤 3：e2e 使用测试库**

确认该 spec 在 `beforeAll` 前没有静态设置 DB 变量时，会连 dev 库 `lucy`。为使 e2e 连 `lucy_test`，在 spec 顶部（`import` 之后、`describe` 之前）加：

```ts
process.env.DB_NAME = 'lucy_test';
```

注意：`ConfigModule.forRoot()` 不会覆盖已存在的 `process.env.DB_NAME`，故该设置生效。

- [ ] **步骤 4：运行 e2e**

运行：`pnpm --filter @lucy/backend test:e2e` 预期：`Auth (e2e)` 全 PASS（需本地 PG 与 Redis 运行中）。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/test/auth.e2e-spec.ts
git commit -m "feat(backend): 认证全链路 e2e 测试"
```

---

## 计划自检结论

- **规格覆盖**：§1-3（方案）、§4（技术栈）、§5（users 表迁移）、§6（模块结构）、§7（令牌生命周期）、§8（布隆混合+轮换+TTL 对齐）、§9（五接口）、§10（错误码）、§11（安全要点：scrypt/cookie/防枚举）、§13（测试：单元+e2e）、§14（环境变量）均有对应任务。**§12 前端集成**留作独立后续计划。
- **占位符**：无 TODO/待定。迁移文件名 `<ts>-` 为工具生成前缀，非占位。
- **类型一致**：`CurrentUserPayload = { userId, jti }` 贯穿 strategy/controller/service；`SafeUser` 为 controller 返回类型；`DenylistService.add/isDenied/ensureInitialized` 命名在任务 8 与 9、10 中一致。

---

## 后续计划（独立子系统，不在本计划）

**前端集成（Umi Max）** 依赖后端 API 契约，单独计划 `docs/superpowers/plans/2026-08-02-login-module-frontend.md`，范围：

- `src/services/auth/`：注册/登录/刷新 API + `typings.d.ts`
- `src/app.ts`：request 拦截器携带 access token，401 静默 `/auth/refresh` 重放
- `src/models/user.ts` + `getInitialState` 登录态
- `src/access.ts`：`isLogin` 权限 + 路由守卫
- `src/pages/Login/index.tsx` 与注册页
