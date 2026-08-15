# Auth Cookie 刷新令牌 + 家族轮换/复用检测 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把认证从「双 token 都进 body + localStorage」改为「长效 refresh token 走 HttpOnly cookie + 短效 access token 走 header/内存」，并保留 refresh token 家族轮换（rotation）与复用检测（reuse detection）。登录接口只返回用户信息，`/auth/refresh` 只返回短效 access token；`/auth/me` 已存在用于刷新后拉取用户。

**架构：**

- **后端**：`login` 只签发 refresh token（写入 HttpOnly cookie）并返回 `{ user }`，不签 access。`refresh` 读 cookie，做「家族轮换 + 复用检测」，返回 `{ accessToken }` 并重设 cookie。refresh token 家族用 Redis 结构：`auth:refresh:<token>`(active 映射 `userId:family`) + `auth:refresh:family:<family>`(SET) + `auth:refresh:reuse:<token>`(被轮换出去的标记，TTL 检测窗口)。检测到复用 → 吊销整个家族。
- **前端**：删除 localStorage 持久化，`authStore` 只剩 `{ user, accessToken }`。新增 `session.ts` 在模块加载时 bootstrap：`refresh`(cookie→access) → `/me`(access→user)，暴露 `ready` Promise 供路由守卫 `await`。`authHeader` 插件只负责附加 Bearer，不再主动预刷新。

**技术栈：** NestJS 11、Redis(ioredis + RedisBloom)、JWT、TanStack Store/Router、hook-fetch、Vitest。

---

## 文件结构

**后端（apps/backend/src/auth/）**

- `dto/login-result.dto.ts` — 重写为 `{ user: User }`
- `dto/refresh-result.dto.ts` — 新建 `{ accessToken: string }`
- `dto/auth-tokens.dto.ts` — **删除**（不再被 login/refresh 共用）
- `dto/refresh.dto.ts` — **删除**（refresh/logout 改纯 cookie）
- `auth.service.ts` — login/refresh/logout 家族化 + 复用检测
- `auth.controller.ts` — cookie-only 读取，返回形状调整
- `auth.service.spec.ts` / `auth.controller.spec.ts` — 重写

**前端（apps/frontend/src/）**

- `api/types.ts` — `RefreshResult`/`LoginResult` 别名，删 `AuthTokens`/`RefreshRequest`
- `api/auth.ts` — 新增 `meApi()`
- `api/client.ts` — `doRefresh` 无 body、`authHeader` 不再预刷新、删 `skipTokenWait`
- `stores/auth.ts` — 删持久化，`AuthState` 只含 user/accessToken，`login(user)`/`applyTokens(accessToken)`
- `session.ts` — 新建，模块级 bootstrap（refresh → /me）
- `auth-context.ts` — `ready: Promise<void>` + `isAuthenticated`
- `routes/_layout.tsx` / `routes/_auth.tsx` — 守卫 `await context.auth.ready`
- `auth/AuthProvider.tsx` — 精简为只注册过期跳转
- `routes/_auth/login.tsx` — `login(result.user)` + eager `refreshTokens()`
- 测试：`stores/auth.test.ts`、`auth-context.test.ts`、`api/client.test.ts`、`auth/AuthProvider.test.tsx` 重写；`session.test.ts` 新建

**共享契约：** `pnpm typegen` 重新生成 `packages/shared/src/generated/openapi.ts`（新增 `RefreshResultDto`、改 `LoginResultDto`、删 `AuthTokensDto`/`RefreshDto`）。

---

### 任务 1：后端 DTO 调整

**文件：**

- 创建：`apps/backend/src/auth/dto/refresh-result.dto.ts`
- 重写：`apps/backend/src/auth/dto/login-result.dto.ts`
- 删除：`apps/backend/src/auth/dto/auth-tokens.dto.ts`
- 删除：`apps/backend/src/auth/dto/refresh.dto.ts`

- [ ] **步骤 1：新建 `refresh-result.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';

export class RefreshResultDto {
  @ApiProperty({
    description: '访问令牌（短效 JWT）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}
```

- [ ] **步骤 2：重写 `login-result.dto.ts`（去掉继承，只留 user）**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/user.entity.js';

export class LoginResultDto {
  @ApiProperty({ description: '当前用户信息', type: User })
  user: User;
}
```

- [ ] **步骤 3：删除 `auth-tokens.dto.ts` 与 `refresh.dto.ts`**

```bash
rm apps/backend/src/auth/dto/auth-tokens.dto.ts apps/backend/src/auth/dto/refresh.dto.ts
```

---

### 任务 2：后端 service + controller 重写

**文件：**

- 修改：`apps/backend/src/auth/auth.service.ts`
- 修改：`apps/backend/src/auth/auth.controller.ts`

- [ ] **步骤 1：重写 `auth.service.ts`**

整文件替换为：

```ts
import type { components } from '@lucy/shared';
import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';

// API 契约类型由 Swagger 生成的 components.schemas 派生，与前端共享同一事实源
type SharedUser = components['schemas']['User'];
type LoginResultDto = components['schemas']['LoginResultDto'];

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

  private familyKey(family: string): string {
    return `auth:refresh:family:${family}`;
  }

  private reuseKey(token: string): string {
    return `auth:refresh:reuse:${token}`;
  }

  private toSharedUser(user: User): SharedUser {
    const { id, username, email, nickname, status, createdAt, updatedAt } =
      user;
    return {
      id,
      username,
      email,
      nickname,
      status,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  async register(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<SharedUser> {
    const user = await this.usersService.create(input);
    return this.toSharedUser(user);
  }

  async login(dto: {
    account: string;
    password: string;
  }): Promise<{ user: SharedUser; refreshToken: string }> {
    const user = dto.account.includes('@')
      ? await this.usersService.findByEmail(dto.account)
      : await this.usersService.findByUsername(dto.account);
    if (!user) {
      // 虚拟 verify：用户不存在时也执行一次 scrypt，抹平与密码错误路径的耗时差，防账号枚举
      await this.passwordService.verify(
        dto.password,
        'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      );
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        '用户名或密码错误',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!(await this.passwordService.verify(dto.password, user.passwordHash))) {
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
    const family = randomUUID();
    const refreshToken = await this.issueRefreshToken(user.id, family);
    return { user: this.toSharedUser(user), refreshToken };
  }

  private async issueRefreshToken(
    userId: string,
    family: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(token),
      `${userId}:${family}`,
      this.refreshTtl(),
    );
    await this.redis.client.sadd(this.familyKey(family), token);
    await this.redis.client.expire(this.familyKey(family), this.refreshTtl());
    return token;
  }

  private async revokeFamily(family: string): Promise<void> {
    const members = await this.redis.client.smembers(this.familyKey(family));
    await Promise.all(
      members.map((t) => this.redis.del(this.refreshKey(t), this.reuseKey(t))),
    );
    await this.redis.del(this.familyKey(family));
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const active = await this.redis.get(this.refreshKey(refreshToken));
    if (!active) {
      // 已不在 active 集合：可能是被轮换掉的旧 token（复用=泄露信号），或已过期
      const reused = await this.redis.get(this.reuseKey(refreshToken));
      if (reused) {
        const family = reused.split(':')[1];
        await this.revokeFamily(family);
        throw new BusinessException(
          ErrorCode.UNAUTHORIZED,
          '刷新令牌无效（检测到令牌复用）',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const [userId, family] = active.split(':');
    const user = await this.usersService.findById(userId);
    if (user?.status !== 1) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '账号不可用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // 轮换：删除旧 token → 记录复用标记 → 同家族签发新 token
    await this.redis.del(this.refreshKey(refreshToken));
    await this.redis.client.srem(this.familyKey(family), refreshToken);
    await this.redis.set(
      this.reuseKey(refreshToken),
      active,
      this.refreshTtl(),
    );
    const newRefreshToken = await this.issueRefreshToken(userId, family);
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(jti: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const active = await this.redis.get(this.refreshKey(refreshToken));
      if (active) {
        await this.revokeFamily(active.split(':')[1]);
      } else {
        await this.redis.del(
          this.refreshKey(refreshToken),
          this.reuseKey(refreshToken),
        );
      }
    }
    await this.denylist.add(jti);
  }

  async me(userId: string): Promise<SharedUser> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '用户不存在',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toSharedUser(user);
  }

  throwMissingRefresh(): never {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '缺少刷新令牌',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

- [ ] **步骤 2：重写 `auth.controller.ts`**

整文件替换为：

```ts
import type { components } from '@lucy/shared';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { User as UserEntity } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import { LoginResultDto } from './dto/login-result.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutResultDto } from './dto/logout-result.dto.js';
import { RefreshResultDto } from './dto/refresh-result.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const REFRESH_COOKIE = 'refreshToken';

// API 契约类型由 Swagger 生成的 components.schemas 派生
type User = components['schemas']['User'];

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册', description: '创建新账号并返回用户信息' })
  @ApiResponse({ status: 201, description: '注册成功', type: UserEntity })
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: '登录',
    description: '账号密码登录，返回用户信息；长效 token 写入 HttpOnly cookie',
  })
  @ApiResponse({ status: 201, description: '登录成功', type: LoginResultDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, refreshToken } = await this.authService.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return { user };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: '刷新令牌',
    description: '读取 HttpOnly cookie 换发短效 access token，并轮换长效 token',
  })
  @ApiResponse({ status: 201, description: '换发成功', type: RefreshResultDto })
  @ApiResponse({ status: 401, description: '缺少或无效的刷新令牌' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      return this.authService.throwMissingRefresh();
    }
    const { accessToken, refreshToken } = await this.authService.refresh(token);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({
    summary: '登出',
    description: '撤销当前会话整个家族并清除 cookie',
  })
  @ApiResponse({ status: 201, description: '登出成功', type: LogoutResultDto })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.authService.logout(user.jti, refreshToken);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前用户信息' })
  @ApiResponse({
    status: 200,
    description: '返回当前登录用户',
    type: UserEntity,
  })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  me(@CurrentUser() user: CurrentUserPayload): Promise<User> {
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

---

### 任务 3：重新生成共享契约并构建 shared

- [ ] **步骤 1：修正 gen-openapi 契约断言**

`apps/backend/scripts/gen-openapi.spec.ts` 第 44-48 行的断言仍写死旧 `LoginResultDto` 形状，需改为 `['user']`：

```ts
expect(
  Object.keys(doc.components?.schemas?.LoginResultDto?.properties ?? {}).sort(),
).toEqual(['user']);
```

- [ ] **步骤 2：运行 typegen**

```bash
pnpm typegen
```

预期：`packages/shared/src/generated/openapi.ts` 更新，出现 `RefreshResultDto`、`LoginResultDto`（仅含 `user`），`AuthTokensDto`/`RefreshDto` 消失。

- [ ] **步骤 3：构建 shared 包（消费方解析 exports.import → dist）**

```bash
pnpm --filter @lucy/shared build
```

- [ ] **步骤 4：验证后端 typecheck 通过**

```bash
pnpm --filter @lucy/backend typecheck
```

预期：无类型错误（`AuthTokensDto`/`RefreshDto` 引用已全部移除）。

---

### 任务 4：后端测试重写（TDD）

**文件：**

- 重写：`apps/backend/src/auth/auth.service.spec.ts`
- 重写：`apps/backend/src/auth/auth.controller.spec.ts`

- [ ] **步骤 1：重写 `auth.service.spec.ts`**

整文件替换为（`redisService.client` 提供 sadd/srem/smembers/expire）：

```ts
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  };
  const passwordService = { verify: vi.fn() };
  const jwtService = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const redisClient = {
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  };
  const redisService = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    client: redisClient,
  };
  const denylist = { add: vi.fn() };

  const user: User = {
    id: 'u1',
    username: 'alice',
    email: 'alice@x.com',
    passwordHash: 'hash',
    nickname: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const activeVal = `${user.id}:family-1`;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('login 成功返回用户与长效 token，不返回短效 token', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    const result = await service.login({ account: 'alice', password: 'p' });
    expect(result.user.username).toBe('alice');
    expect(result.refreshToken).toBeTruthy();
    expect(result).not.toHaveProperty('accessToken');
    expect(
      (result.user as { passwordHash?: string }).passwordHash,
    ).toBeUndefined();
    expect(redisService.set).toHaveBeenCalledWith(
      `auth:refresh:${result.refreshToken}`,
      activeVal,
      expect.any(Number),
    );
    expect(redisClient.sadd).toHaveBeenCalled();
  });

  it('login 密码错误抛 40102', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(false);
    await expect(
      service.login({ account: 'alice', password: 'x' }),
    ).rejects.toThrow(BusinessException);
  });

  it('login 用户不存在也执行一次虚拟 verify 且抛 40102', async () => {
    usersService.findByUsername.mockResolvedValue(null);
    passwordService.verify.mockResolvedValue(false);
    await expect(
      service.login({ account: 'ghost', password: 'x' }),
    ).rejects.toThrow(BusinessException);
    expect(passwordService.verify).toHaveBeenCalledTimes(1);
  });

  it('login email 走 findByEmail', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    await service.login({ account: 'alice@x.com', password: 'p' });
    expect(usersService.findByEmail).toHaveBeenCalledWith('alice@x.com');
  });

  it('login 账号禁用抛异常', async () => {
    usersService.findByUsername.mockResolvedValue({ ...user, status: 0 });
    passwordService.verify.mockResolvedValue(true);
    await expect(
      service.login({ account: 'alice', password: 'p' }),
    ).rejects.toThrow(BusinessException);
  });

  it('refresh 成功轮换：删旧 key、srem、写复用标记、同家族新增', async () => {
    redisService.get.mockResolvedValue(activeVal);
    usersService.findById.mockResolvedValue(user);
    const result = await service.refresh('old');
    expect(redisService.del).toHaveBeenCalledWith('auth:refresh:old');
    expect(redisClient.srem).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
      'old',
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:refresh:reuse:old',
      activeVal,
      expect.any(Number),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      `auth:refresh:${result.refreshToken}`,
      activeVal,
      expect.any(Number),
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('old');
  });

  it('refresh 复用已轮换 token 时吊销整个家族并抛 Unauthorized', async () => {
    redisService.get.mockResolvedValueOnce(null);
    redisService.get.mockResolvedValueOnce(activeVal);
    redisClient.smembers.mockResolvedValue(['t1', 't2']);
    await expect(service.refresh('old')).rejects.toThrow(BusinessException);
    expect(redisClient.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:refresh:t1',
      'auth:refresh:reuse:t1',
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:refresh:t2',
      'auth:refresh:reuse:t2',
    );
  });

  it('refresh 无效 token（非复用）抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue(null);
    await expect(service.refresh('bad')).rejects.toThrow(BusinessException);
  });

  it('refresh 用户不存在抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue(activeVal);
    usersService.findById.mockResolvedValue(null);
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('refresh 用户已禁用抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue(activeVal);
    usersService.findById.mockResolvedValue({ ...user, status: 0 });
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('me 返回用户信息且不含 passwordHash', async () => {
    usersService.findById.mockResolvedValue(user);
    const result = await service.me('1');
    expect(result).toEqual(expect.objectContaining({ id: 'u1' }));
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('me 用户不存在抛 Unauthorized', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(service.me('x')).rejects.toThrow(BusinessException);
  });

  it('logout 带有效 refreshToken 吊销整个家族', async () => {
    redisService.get.mockResolvedValue(activeVal);
    redisClient.smembers.mockResolvedValue(['t1']);
    await service.logout('jti-1', 'r');
    expect(redisClient.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
  });

  it('logout 无 refreshToken 仅加入 denylist', async () => {
    await service.logout('jti-1');
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('throwMissingRefresh 抛 BusinessException', () => {
    expect(() => service.throwMissingRefresh()).toThrow(BusinessException);
  });

  it('refreshTtl 返回默认 7 天', () => {
    expect(service.refreshTtl()).toBe(604800);
  });
});
```

> **复用检测测试的 mock 顺序说明**：`service.refresh('old')` 在复用分支里先后 `get(active)`（Once null）与 `get(reuse)`（Once activeVal），恰好两次调用，用 `mockResolvedValueOnce` 依次提供即可。

- [ ] **步骤 2：重写 `auth.controller.spec.ts`**

整文件替换为（refresh/logout 纯 cookie，无 body）：

```ts
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    throwMissingRefresh: vi.fn(),
    refreshTtl: vi.fn().mockReturnValue(604800),
  };

  const safeUser = {
    id: '1',
    username: 'alice',
    email: 'alice@x.com',
    nickname: null,
    status: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  const resMock = { cookie: vi.fn(), clearCookie: vi.fn() };
  const res = resMock as unknown as Response;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('register 委托 authService.register 并返回 User', async () => {
    authService.register.mockResolvedValue(safeUser);
    const dto = {
      username: 'alice',
      email: 'alice@x.com',
      password: 'p',
      nickname: 'A',
    };
    await expect(controller.register(dto)).resolves.toBe(safeUser);
    expect(authService.register).toHaveBeenCalledWith(dto);
  });

  it('login 写 httpOnly refresh cookie 并只返回 user', async () => {
    authService.login.mockResolvedValue({
      user: safeUser,
      refreshToken: 'r',
    });
    const dto = { account: 'alice', password: 'p' };
    await expect(controller.login(dto, res)).resolves.toEqual({
      user: safeUser,
    });
    expect(resMock.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'r',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 604800 * 1000,
      }),
    );
  });

  it('refresh 只读 cookie，返回 { accessToken } 并重设 cookie', async () => {
    authService.refresh.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r2',
    });
    const req = {
      cookies: { refreshToken: 'cookie-token' },
    } as unknown as Request;
    await expect(controller.refresh(req, res)).resolves.toEqual({
      accessToken: 'a',
    });
    expect(authService.refresh).toHaveBeenCalledWith('cookie-token');
    expect(resMock.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'r2',
      expect.any(Object),
    );
  });

  it('refresh 缺少 cookie 委托 throwMissingRefresh', async () => {
    authService.throwMissingRefresh.mockImplementation(() => {
      throw new Error('missing');
    });
    const req = { cookies: {} } as unknown as Request;
    await expect(controller.refresh(req, res)).rejects.toThrow('missing');
    expect(authService.throwMissingRefresh).toHaveBeenCalled();
  });

  it('logout 读 cookie 吊销家族、清除 cookie 并返回 success', async () => {
    authService.logout.mockResolvedValue(undefined);
    const user = { userId: '1', jti: 'jti-1' };
    const req = { cookies: { refreshToken: 'r' } } as unknown as Request;
    await expect(controller.logout(user, req, res)).resolves.toEqual({
      success: true,
    });
    expect(authService.logout).toHaveBeenCalledWith('jti-1', 'r');
    expect(resMock.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.any(Object),
    );
  });

  it('me 返回当前用户信息', async () => {
    authService.me.mockResolvedValue(safeUser);
    const user = { userId: '1', jti: 'jti-1' };
    await expect(controller.me(user)).resolves.toBe(safeUser);
    expect(authService.me).toHaveBeenCalledWith('1');
  });
});
```

- [ ] **步骤 3：运行后端全部测试**

```bash
pnpm --filter @lucy/backend test
```

预期：全部 PASS。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/src/auth
git commit -m "feat(auth): refresh token 走 HttpOnly cookie，家族轮换+复用检测，login 只返回用户"
```

---

### 任务 5：前端 api 客户端类型与 meApi

**文件：**

- 修改：`apps/frontend/src/api/types.ts`
- 修改：`apps/frontend/src/api/auth.ts`

- [ ] **步骤 1：改 `api/types.ts`**

把前 9 行改为（删 `AuthTokens`/`RefreshRequest`，`LoginResult` 形状由生成类型决定）：

```ts
export type RefreshResult = components['schemas']['RefreshResultDto'];
export type LoginResult = components['schemas']['LoginResultDto'];
```

- [ ] **步骤 2：`api/auth.ts` 新增 `meApi`**

在 `logoutApi` 之后追加（复用已导入的 `User` 别名——`components` 在本文件未导入，切勿用全拼）：

```ts
export function meApi() {
  return http.get<User>('auth/me').json();
}
```

（`http.get` 由 hook-fetch 提供；`meApi` 用 Bearer，401 由 refreshOn401 处理。）

---

### 任务 6：前端 authStore 精简（删持久化）

**文件：**

- 重写：`apps/frontend/src/stores/auth.ts`
- 重写：`apps/frontend/src/stores/auth.test.ts`

- [ ] **步骤 1：重写 `stores/auth.ts`**

整文件替换为：

```ts
import { createStore } from '@tanstack/store';
import type { User } from '../api/types';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
}

// 纯内存：accessToken 不落盘；user 由登录返回或 /me 拉取，也不落盘
export const authStore = createStore<AuthState>({
  user: null,
  accessToken: null,
});

// 派生状态：user 非空即视为已登录（会话恢复由 session.ts bootstrap 完成）
export const isLoggedInStore = createStore(() => authStore.get().user !== null);

// —— 会话过期回调：由 AuthProvider 注册，跳转登录页 ——
let sessionExpiredHandler: () => void = () => {};
export function registerSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

export function login(user: User) {
  authStore.setState(() => ({ user, accessToken: null }));
}

// 刷新成功写入新的短效 token（保留现有 user）
export function applyTokens(accessToken: string) {
  const { user } = authStore.get();
  authStore.setState(() => ({ user, accessToken }));
}

export function logout() {
  authStore.setState(() => ({ user: null, accessToken: null }));
}

// 刷新失败 → 清空本地会话并通知跳转
export function handleSessionExpired() {
  logout();
  sessionExpiredHandler();
}
```

- [ ] **步骤 2：重写 `stores/auth.test.ts`**

整文件替换为：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUser } from '../test/fixtures';
import {
  applyTokens,
  authStore,
  handleSessionExpired,
  isLoggedInStore,
  login,
  logout,
  registerSessionExpired,
} from './auth';

const user = makeUser();

describe('authStore', () => {
  beforeEach(() => {
    logout();
    registerSessionExpired(() => {});
  });

  it('初始状态为空且未登录', () => {
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('login 写入用户并标记已登录，不带令牌', () => {
    login(user);
    expect(authStore.get()).toEqual({ user, accessToken: null });
    expect(isLoggedInStore.get()).toBe(true);
  });

  it('applyTokens 写入短效 token 并保留用户', () => {
    login(user);
    applyTokens('at-new');
    expect(authStore.get()).toEqual({ user, accessToken: 'at-new' });
  });

  it('logout 清空会话并恢复未登录', () => {
    login(user);
    applyTokens('at');
    logout();
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('默认会话过期回调为空操作', () => {
    login(user);
    expect(() => handleSessionExpired()).not.toThrow();
    expect(authStore.get().accessToken).toBeNull();
  });

  it('handleSessionExpired 调用已注册回调并清空会话', () => {
    const handler = vi.fn();
    registerSessionExpired(handler);
    login(user);
    handleSessionExpired();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(authStore.get().user).toBeNull();
  });
});
```

- [ ] **步骤 3：运行前端 store 测试**

```bash
pnpm --filter @lucy/frontend test src/stores/auth.test.ts
```

预期：全部 PASS。

---

### 任务 7：session bootstrap + auth-context + 路由守卫

**文件：**

- 创建：`apps/frontend/src/session.ts`
- 创建：`apps/frontend/src/session.test.ts`
- 修改：`apps/frontend/src/auth-context.ts`
- 重写：`apps/frontend/src/auth-context.test.ts`
- 修改：`apps/frontend/src/routes/_layout.tsx`
- 修改：`apps/frontend/src/routes/_auth.tsx`

- [ ] **步骤 1：新建 `session.ts`**

```ts
import { meApi } from './api/auth';
import { refreshTokens } from './api/client';
import { authStore, logout } from './stores/auth';

// 模块级单飞 bootstrap：页面加载即恢复会话
// refresh(cookie→accessToken) → /me(accessToken→user)；失败视为未登录
let bootstrap: Promise<void> | null = null;
export function authBootstrap(): Promise<void> {
  bootstrap ??= (async () => {
    try {
      const tokens = await refreshTokens();
      authStore.setState(() => ({
        user: null,
        accessToken: tokens.accessToken,
      }));
      const user = await meApi();
      authStore.setState(() => ({
        user,
        accessToken: authStore.get().accessToken,
      }));
    } catch {
      // 无 cookie / 刷新失败 / /me 失败 → 静默置为未登录；跳转交给路由守卫
      logout();
    }
  })();
  return bootstrap;
}
```

> 说明：bootstrap 的 catch 里**不**调 `handleSessionExpired`（避免在登录页产生多余跳转），直接 `logout()`；未登录时 `_layout` 守卫会 `redirect` 到 `/login`。

- [ ] **步骤 2：新建 `session.test.ts`**

> 注意：`session.ts` 的 `bootstrap` 是模块级单飞缓存。若测试之间不重置模块，先执行的用例会把它的 Promise 经 `??=` 缓存进 `bootstrap`，后续用例命中缓存、其分支（尤其失败 catch→logout）永不执行——即假绿。因此每条用例先 `vi.resetModules()`，再对被测模块与依赖做动态 import，取全新模块实例与全新 mock fn。所有导入都用动态 import（避免静态导入指向旧实例）。

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeUser } from './test/fixtures';

vi.mock('./api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('./api/auth', () => ({ meApi: vi.fn() }));

const user = makeUser();

// 重置模块注册表，取全新 session 模块（bootstrap=null）与全新依赖 mock fn
async function loadAuth() {
  vi.resetModules();
  const session = await import('./session');
  const { authStore } = await import('./stores/auth');
  const { refreshTokens } = await import('./api/client');
  const { meApi } = await import('./api/auth');
  authStore.setState(() => ({ user: null, accessToken: null }));
  return {
    authBootstrap: session.authBootstrap,
    authStore,
    refreshTokens,
    meApi,
  };
}

describe('authBootstrap', () => {
  it('成功后写入 accessToken 与 user', async () => {
    const { authBootstrap, authStore, refreshTokens, meApi } = await loadAuth();
    vi.mocked(refreshTokens).mockResolvedValue({ accessToken: 'at' });
    vi.mocked(meApi).mockResolvedValue(user);
    await authBootstrap();
    expect(authStore.get()).toEqual({ user, accessToken: 'at' });
  });

  it('失败时静默登出', async () => {
    const { authBootstrap, authStore, refreshTokens } = await loadAuth();
    vi.mocked(refreshTokens).mockRejectedValue(new Error('no session'));
    await authBootstrap();
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
  });
});
```

- [ ] **步骤 3：改 `auth-context.ts`**

整文件替换为：

```ts
import { authBootstrap } from './session';
import { isLoggedInStore } from './stores/auth';

export interface AuthRouterContext {
  ready: Promise<void>;
  isAuthenticated: boolean;
}

// ready 在模块加载时即启动会话恢复；beforeLoad 守卫 await 后再判定登录态
export const authRouterContext: AuthRouterContext = {
  ready: authBootstrap(),
  get isAuthenticated() {
    return isLoggedInStore.get();
  },
};
```

- [ ] **步骤 4：重写 `auth-context.test.ts`**

整文件替换为：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRouterContext } from './auth-context';
import { logout } from './stores/auth';
import { makeUser } from './test/fixtures';

vi.mock('./api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('./api/auth', () => ({ meApi: vi.fn() }));
vi.mock('./session', async () => {
  const actual = await vi.importActual<typeof import('./session')>('./session');
  return { ...actual, authBootstrap: () => Promise.resolve() };
});

const user = makeUser();

describe('authRouterContext', () => {
  beforeEach(() => {
    logout();
  });

  it('ready 为已解析的 Promise', async () => {
    await expect(authRouterContext.ready).resolves.toBeUndefined();
  });

  it('未登录时 isAuthenticated 为 false', () => {
    expect(authRouterContext.isAuthenticated).toBe(false);
  });

  it('登录后 isAuthenticated 为 true', () => {
    const { login } = require('./stores/auth');
    login(user);
    expect(authRouterContext.isAuthenticated).toBe(true);
  });
});
```

> `vi.mock('./session', ...)` 让 `ready` 不触发真实网络；`isAuthenticated` getter 直接读 store，与 bootstrap 无关，同步可测。`login` 需动态 require（因顶部已有 mock）。

- [ ] **步骤 5：改路由守卫**

`routes/_layout.tsx` 的 `beforeLoad` 改为：

```ts
beforeLoad: async ({ context }) => {
  await context.auth.ready;
  if (!context.auth.isAuthenticated) {
    throw redirect({ to: '/login' });
  }
},
```

`routes/_auth.tsx` 的 `beforeLoad` 改为：

```ts
beforeLoad: async ({ context }) => {
  await context.auth.ready;
  if (context.auth.isAuthenticated) {
    throw redirect({ to: '/' });
  }
},
```

- [ ] **步骤 6：运行前端测试**

```bash
pnpm --filter @lucy/frontend test src/session.test.ts src/auth-context.test.ts
```

预期：全部 PASS。

---

### 任务 8：前端 client.ts（doRefresh 无 body、authHeader 不再预刷新）

**文件：**

- 修改：`apps/frontend/src/api/client.ts`
- 重写：`apps/frontend/src/api/client.test.ts`

- [ ] **步骤 1：改 `client.ts`**

1. 顶部 import 改为：

```ts
import { applyTokens, authStore, handleSessionExpired } from '../stores/auth';
import type { RefreshResult } from './types';
```

2. `RequestExtra` 删除 `skipTokenWait` 字段（authHeader 不再预刷新）：

```ts
// 请求级扩展字段：
//   skipAuthRefresh  跳过 401 自动刷新（登录/注册/刷新/SSE 流等不适配重放）
//   __authRetry      记录 401 重放次数
type RequestExtra = {
  skipAuthRefresh?: boolean;
  __authRetry?: number;
};
```

3. `authHeader` 插件改为只附加 token：

```ts
const authHeader: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'auth-header',
  async beforeRequest(ctx) {
    ctx.config.headers = new Headers(ctx.config.headers);
    // accessToken 缺失时不主动预刷新：bootstrap 与 refreshOn401 已保证其可用，
    // 避免在登录页/匿名请求上无谓地触发刷新。
    const { accessToken } = authStore.get();
    if (accessToken) {
      ctx.config.headers.set('Authorization', `Bearer ${accessToken}`);
    } else {
      ctx.config.headers.delete('Authorization');
    }
    return ctx.config;
  },
};
```

4. `doRefresh` / `refreshTokens` 改为无 body、单参数 token：

```ts
let refreshPromise: Promise<RefreshResult> | null = null;

// 单飞刷新：并发 401 只触发一次刷新，其余请求复用同一次刷新结果
async function doRefresh(): Promise<RefreshResult> {
  try {
    // 长效 token 在 HttpOnly cookie 里，浏览器自动携带，无需传 body
    const tokens = await http
      .post<RefreshResult>('auth/refresh', undefined, {
        extra: { skipAuthRefresh: true },
      })
      .json();
    applyTokens(tokens.accessToken);
    return tokens;
  } catch {
    handleSessionExpired();
    throw new ApiError('登录已过期，请重新登录');
  }
}

export function refreshTokens(): Promise<RefreshResult> {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
```

> `auth/refresh` 用 `skipAuthRefresh` 防止其自身 401 触发递归刷新；无 cookie 时后端返回 401 → 走 handleSessionExpired。

- [ ] **步骤 2：重写 `client.test.ts`**

整文件替换为（authHeader 不再预刷新，所有刷新响应改为 `{ accessToken }`）：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTokens,
  authStore,
  login,
  logout,
  registerSessionExpired,
} from '../stores/auth';
import { makeUser } from '../test/fixtures';
import { ApiError, http, refreshTokens } from './client';

const fetchMock = vi.fn();
const user = makeUser();

const okEnvelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
  });
const refreshEnvelope = (accessToken: string) => okEnvelope({ accessToken });

describe('api/client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    logout();
    registerSessionExpired(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('信封解包与错误归一化', () => {
    it('解包成功响应并返回 data', async () => {
      fetchMock.mockResolvedValueOnce(okEnvelope({ id: '1' }));
      const data = await http
        .post<{ id: string }>('auth/login', { account: 'a', password: 'b' })
        .json();
      expect(data).toEqual({ id: '1' });
    });

    it('业务错误码抛出 ApiError', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 40102, message: '密码错误', data: null }),
          { status: 200 },
        ),
      );
      await expect(http.post('auth/login', {}).json()).rejects.toMatchObject({
        name: 'ApiError',
        code: 40102,
        message: '密码错误',
      });
    });

    it('HTTP 错误状态抛出 ApiError 并携带 status', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 50000, message: '服务器错误', data: null }),
          { status: 500 },
        ),
      );
      await expect(http.post('auth/login', {}).json()).rejects.toMatchObject({
        name: 'ApiError',
        code: 50000,
        status: 500,
        message: '服务器错误',
      });
    });
  });

  describe('认证头', () => {
    it('有短效 token 时附加 Bearer 头', async () => {
      login(user);
      applyTokens('tok');
      fetchMock.mockResolvedValueOnce(okEnvelope({ ok: true }));
      await http.post<{ ok: boolean }>('auth/logout').json();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    });

    it('无短效 token 时不附加 Authorization 头，也不触发预刷新', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(okEnvelope({ ok: true }));
      await http.post('auth/logout').json();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('401 自动刷新', () => {
    it('401 时刷新并携带新令牌重试一次', async () => {
      login(user);
      applyTokens('expired');
      fetchMock
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(refreshEnvelope('new-token'))
        .mockResolvedValueOnce(okEnvelope({ ok: true }));

      const result = await http.post<{ ok: boolean }>('auth/logout').json();
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(authStore.get().accessToken).toBe('new-token');
      const retried = fetchMock.mock.calls[2][1] as RequestInit;
      expect(new Headers(retried.headers).get('Authorization')).toBe(
        'Bearer new-token',
      );
    });

    it('401 且刷新失败时请求被拒绝', async () => {
      login(user);
      applyTokens('expired');
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockRejectedValueOnce(new TypeError('network'));

      await expect(http.post('auth/logout').json()).rejects.toThrow(
        '登录已过期，请重新登录',
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('刷新后重放仍 401 判定会话过期', async () => {
      login(user);
      applyTokens('expired');
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(refreshEnvelope('new'))
        .mockResolvedValueOnce(new Response('', { status: 401 }));

      await expect(http.post('auth/logout').json()).rejects.toThrow(
        '登录已过期，请重新登录',
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('skipAuthRefresh 的请求不触发 401 刷新', async () => {
      login(user);
      applyTokens('expired');
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 40101, message: '密码错误', data: null }),
          { status: 401 },
        ),
      );
      await expect(
        http
          .post('auth/login', {}, { extra: { skipAuthRefresh: true } })
          .json(),
      ).rejects.toMatchObject({ name: 'ApiError', code: 40101, status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshTokens', () => {
    it('单飞：并发刷新只发一次请求', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      const [a, b] = await Promise.all([refreshTokens(), refreshTokens()]);
      expect(a).toEqual({ accessToken: 'at2' });
      expect(b).toBe(a);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('刷新成功后写入短效 token 并保留用户', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      await refreshTokens();
      expect(authStore.get().accessToken).toBe('at2');
      expect(authStore.get().user).toBe(user);
    });

    it('刷新请求不携带 body', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      await refreshTokens();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('刷新失败时过期并拒绝', async () => {
      login(user);
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock.mockRejectedValueOnce(new TypeError('network'));
      await expect(refreshTokens()).rejects.toThrow('登录已过期，请重新登录');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('刷新返回 401（无 cookie）时过期并拒绝', async () => {
      login(user);
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(refreshTokens()).rejects.toThrow('登录已过期，请重新登录');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('ApiError', () => {
    it('构造时可携带 code 与 status', () => {
      const err = new ApiError('boom', 42, 500);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ApiError');
      expect(err.code).toBe(42);
      expect(err.status).toBe(500);
    });
  });
});
```

> 测试里调用 `applyTokens('tok')` 已从 `../stores/auth` import。

- [ ] **步骤 3：运行前端 client 测试**

```bash
pnpm --filter @lucy/frontend test src/api/client.test.ts
```

预期：全部 PASS。

---

### 任务 9：AuthProvider 精简 + login.tsx

**文件：**

- 重写：`apps/frontend/src/auth/AuthProvider.tsx`
- 重写：`apps/frontend/src/auth/AuthProvider.test.tsx`
- 修改：`apps/frontend/src/routes/_auth/login.tsx`

- [ ] **步骤 1：重写 `AuthProvider.tsx`**

整文件替换为：

```tsx
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { router } from '../router';
import { registerSessionExpired } from '../stores/auth';

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  useEffect(() => {
    registerSessionExpired(() => {
      void router.navigate({ to: '/login' });
    });
  }, []);

  return <>{children}</>;
}
```

> 会话恢复（bootstrap）已在 `auth-context.ts` 模块加载时触发，AuthProvider 只负责注册过期跳转，不再管理持久化。

- [ ] **步骤 2：重写 `AuthProvider.test.tsx`**

整文件替换为：

```tsx
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '../router';
import { handleSessionExpired, logout } from '../stores/auth';
import { AuthProvider } from './AuthProvider';

vi.mock('../router', () => ({ router: { navigate: vi.fn() } }));

const navigateMock = vi.mocked(router.navigate);

describe('AuthProvider', () => {
  beforeEach(() => {
    logout();
  });

  it('渲染子节点', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('会话过期时跳转登录页', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    act(() => {
      handleSessionExpired();
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
  });
});
```

- [ ] **步骤 3：改 `login.tsx`**

`onSubmit` 改为（登录返回 `{ user }`，随后静默刷新拿短效 token）：

```tsx
import { login } from '@/stores/auth';
import { refreshTokens } from '@/api/client';

const onSubmit = async (values: LoginFormValues) => {
  try {
    const result = await loginMutation.mutateAsync(values);
    login(result.user);
    // 长效 token 已写入 HttpOnly cookie，这里静默换发短效 token 供后续请求
    await refreshTokens();
    message.success('登录成功');
    navigate({ to: '/' });
  } catch (err) {
    message.error(err instanceof Error ? err.message : '登录失败');
  }
};
```

> 若 `refreshTokens` 在登录后失败（理论上 cookie 刚写入不会），会走 handleSessionExpired 跳登录，属防御性兜底。

- [ ] **步骤 4：运行前端 AuthProvider 测试**

```bash
pnpm --filter @lucy/frontend test src/auth/AuthProvider.test.tsx
```

预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/frontend/src
git commit -m "feat(frontend): 会话恢复改 cookie bootstrap，删 localStorage 持久化，login 只存 user"
```

---

### 任务 10：全量验证

- [ ] **步骤 1：类型检查（含 shared 构建）**

```bash
pnpm typecheck
```

预期：全部通过。

- [ ] **步骤 2：lint**

```bash
pnpm lint
```

预期：无新增错误（lint 自带 --fix）。

- [ ] **步骤 3：全量测试**

```bash
pnpm test
```

预期：全部 PASS。

- [ ] **步骤 4：构建**

```bash
pnpm build
```

预期：成功。

---

## 自检

- **规格覆盖度**：login 只返回 user ✓（任务 2/4）、refresh 只返回 access ✓（任务 2/4）、cookie 承载 refresh ✓（任务 2）、rotation+reuse detection ✓（任务 2/4）、access header+内存 ✓（任务 6/8）、无 localStorage ✓（任务 6/7/9）、/me 拉取用户 ✓（任务 5/7）、路由守卫异步恢复 ✓（任务 7）、typegen ✓（任务 3）。
- **占位符扫描**：无 TODO/占位，所有代码块完整。
- **类型一致性**：`login(user)` 单参、`applyTokens(accessToken)` 单参、`refreshTokens(): Promise<RefreshResult>`、`RefreshResult = { accessToken }`、`LoginResult = { user }` 在各任务间一致。`RedisService.client`（raw ioredis）提供 `sadd/srem/smembers/expire`。

## 最终审查修复与后续硬化

**已修复（最终审查 3 个 Important）：**

- **旧格式 Redis 值解析**：改造前写入的 `auth:refresh:<token>` 值只有 `userId`（无 `:family`），存量旧 token 刷新时 `split(':')[1]` 得 `undefined`，全部归入 `family:undefined` 命名空间，任一复用/登出会批量吊销所有存量旧会话。现 `AuthService.parseActive()` 对非「userId:family」格式（无 family、空段或损坏值）一律返回 `null`，`refresh()` 遇之删除 key 并视为无效、绝不写入 `family:undefined`；`refresh()` 复用检测与 `logout()` 均改用 `parseActive()`，仅对合法 family 吊销。新增用例覆盖。
- **cookie Secure 环境驱动**：`auth.controller.ts` 原硬编码 `secure: false`，现改为 `this.authService.cookieSecure()`，由 `AuthService` 按 `NODE_ENV === 'production'` 返回，生产强制 HTTPS-only。

**后续硬化（未做，记入后续）：**

- **多标签页共享 cookie 下的非原子轮换**：多标签页共享同一 HttpOnly cookie 时，若多个请求并发轮换同一 refresh token，非原子读-删-写可能在轮询场景触发复用误判，把整族登出。建议改为原子 Lua 脚本完成「校验+删除+写复用标记+签发新 token」，或引入复用宽限期（在宽限期内允许合法重放，仅记录不吊销）。

**次要项 deferred：**

- 任何刷新失败都被当会话过期处理（未区分账号禁用/复用/格式损坏的具体原因）。
- bootstrap 双导航：初始水合时可能触发两次导航，可进一步收敛。
- reuse 标记存多余字段：`reuseKey` 值仅需家族标识，现存完整 active 值。
- refresh 返回 401 时不清理 cookie（前端需自行处理）。
- 后端测试断言偏弱：部分用例仅断言被调用，未断言具体参数/副作用。
