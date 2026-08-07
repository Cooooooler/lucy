# Scalar API 文档模块实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 后端新增 `src/docs/` 独立模块，用 Scalar 渲染 API 文档，仅开发环境暴露 `/docs`（UI）与 `/docs-json`（原始 OpenAPI）。

**架构：** `DocsModule` 提供静态 `setup(app)`，在 `main.ts` 的 `bootstrap()` 中调用。`SwaggerModule.createDocument` 基于现有 controller + DTO 的注解生成 OpenAPI，`apiReference` 中间件渲染 Scalar UI，adapter 层直接输出原始 JSON（绕过全局响应信封拦截器）。`NODE_ENV === 'production'` 时 setup 为空操作。

**技术栈：** NestJS 11 + Express，`@nestjs/swagger@^11.4.6`，`@scalar/nestjs-api-reference@^1.2.13`，Vitest e2e（沿用现有 `test/*.e2e-spec.ts` 约定）。

**环境前提：** e2e 测试 boot 真实 `AppModule`，需要 PostgreSQL（库 `lucy_test`）与 Redis 可用（与现有 `test/auth.e2e-spec.ts` 相同）；先 `docker compose up -d` 并确保 `lucy_test` 库存在。

---

## 任务 1：安装依赖

**文件：**

- 修改：`apps/backend/package.json`（pnpm 自动更新）
- 验证：`apps/backend/pnpm-lock.yaml` 更新

- [ ] **步骤 1：安装依赖**

```bash
pnpm --filter @lucy/backend add @nestjs/swagger@^11.4.6 @scalar/nestjs-api-reference@^1.2.13
```

- [ ] **步骤 2：确认依赖与基线 typecheck**

```bash
pnpm --filter @lucy/backend typecheck
```

预期：PASS（当前无类型错误）。

- [ ] **步骤 3：Commit**

```bash
git add apps/backend/package.json apps/backend/pnpm-lock.yaml
git commit -m "chore(backend): 引入 @nestjs/swagger 与 @scalar/nestjs-api-reference"
```

---

## 任务 2：编写失败的 docs e2e 测试

**文件：**

- 创建：`apps/backend/test/docs.e2e-spec.ts`

- [ ] **步骤 1：编写测试文件**

```ts
process.env.DB_NAME = 'lucy_test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DocsModule } from '../src/docs/docs.module.js';

describe('Scalar docs (dev)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    DocsModule.setup(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/docs 返回 Scalar HTML', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Scalar API Reference');
  });

  it('/docs-json 暴露完整 OpenAPI 文档', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json');
    expect(res.status).toBe(200);
    const doc = res.body;
    expect(doc.info.title).toBe('Lucy API');
    expect(doc.components?.securitySchemes?.bearer).toBeDefined();
    for (const path of [
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
    ]) {
      expect(doc.paths[path]).toBeDefined();
    }
    expect(JSON.stringify(doc.paths['/auth/me'].get?.security ?? [])).toContain(
      'bearer',
    );
    expect(
      doc.components?.schemas?.RegisterDto?.properties?.username,
    ).toBeDefined();
    expect(doc.components?.schemas?.LoginResultDto).toBeDefined();
    expect(doc.components?.schemas?.User?.properties?.username).toBeDefined();
    expect(
      doc.components?.schemas?.User?.properties?.passwordHash,
    ).toBeUndefined();
  });
});

describe('Scalar docs (production no-op)', () => {
  let app: INestApplication<Server>;
  const savedEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    DocsModule.setup(app);
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = savedEnv;
  });

  it('/docs 与 /docs-json 均 404', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm --filter @lucy/backend test:e2e test/docs.e2e-spec.ts
```

预期：FAIL —— `../src/docs/docs.module.js` 模块不存在（编译错误）。

- [ ] **步骤 3：不提交，进入任务 3**

> 测试引用的 `docs.module.ts` 尚不存在，单独提交会被 pre-commit 的 `pnpm typecheck`（TS2307）拦截。测试与实现一起在任务 3 提交（TDD 红绿循环保留，只提交绿色状态）。

---

## 任务 3：实现 DocsModule 并接入 main

**文件：**

- 创建：`apps/backend/src/docs/docs.module.ts`
- 修改：`apps/backend/src/main.ts:7`

- [ ] **步骤 1：实现 DocsModule**

创建 `apps/backend/src/docs/docs.module.ts`：

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { RequestHandler } from 'express';

export class DocsModule {
  static setup(app: INestApplication): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const config = new DocumentBuilder()
      .setTitle('Lucy API')
      .setDescription('Lucy 后端接口文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    // apiReference 返回 `(FastifyRequest|Request, res)` 联合类型，非 Express RequestHandler，
    // 需经 unknown 断言后传给 app.use
    app.use(
      '/docs',
      apiReference({ content: document }) as unknown as RequestHandler,
    );
    app.getHttpAdapter().get('/docs-json', (_req, res) => {
      res.json(document);
    });
  }
}
```

> 若实现时 `apiReference({ content: document })` 的 `content` 类型不匹配（`OpenAPIObject` 与 `OpenAPI.Document` 差异），改用 `apiReference({ url: '/docs-json' })`（Scalar 运行时拉取该 URL 的 spec，同样可用）。

- [ ] **步骤 2：接入 main.ts**

修改 `apps/backend/src/main.ts`，在第 2 行 `import { AppModule } from './app.module.js';` 之后新增导入，并在 `app.use(cookieParser());` 之后调用：

```ts
import { DocsModule } from './docs/docs.module.js';
```

```ts
app.use(cookieParser());
DocsModule.setup(app);
```

- [ ] **步骤 3：typecheck + 运行 e2e 验证**

```bash
pnpm --filter @lucy/backend typecheck
pnpm --filter @lucy/backend test:e2e test/docs.e2e-spec.ts
```

预期：typecheck PASS。e2e 中 `/docs` HTML、`/docs-json` 的 `info.title`/`securitySchemes.bearer`/5 个 auth 路径、production 404 全部 PASS；`RegisterDto.properties.username`、`LoginResultDto`、`User` schema 相关断言仍 FAIL（等待任务 4-6 注解）。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/src/docs/docs.module.ts apps/backend/src/main.ts apps/backend/test/docs.e2e-spec.ts
git commit -m "feat(backend): 新增 DocsModule，dev 环境暴露 Scalar 文档"
```

---

## 任务 4：注解请求 DTO

**文件：**

- 修改：`apps/backend/src/auth/dto/register.dto.ts`
- 修改：`apps/backend/src/auth/dto/login.dto.ts`
- 修改：`apps/backend/src/auth/dto/refresh.dto.ts`

- [ ] **步骤 1：注解 register.dto.ts**

```ts
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: '用户名，仅支持字母数字下划线连字符',
    example: 'lucy',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: '密码（8-72 位）',
    example: 'Password1!',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @Length(8, 72)
  password: string;

  @ApiPropertyOptional({ description: '昵称', example: 'Lucy' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;
}
```

- [ ] **步骤 2：注解 login.dto.ts**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '用户名或邮箱', example: 'lucy' })
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({ description: '密码', example: 'Password1!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
```

- [ ] **步骤 3：注解 refresh.dto.ts**

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({
    description: 'refresh token，缺省时读取 HttpOnly cookie `refreshToken`',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
```

- [ ] **步骤 4：验证 DTO schema 出现**

```bash
pnpm --filter @lucy/backend test:e2e test/docs.e2e-spec.ts
```

预期：`RegisterDto.properties.username` 断言转为 PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/auth/dto/register.dto.ts apps/backend/src/auth/dto/login.dto.ts apps/backend/src/auth/dto/refresh.dto.ts
git commit -m "docs(backend): 注解注册/登录/刷新 DTO"
```

---

## 任务 5：注解 auth.controller + 响应 DTO

**文件：**

- 创建：`apps/backend/src/auth/dto/login-result.dto.ts`
- 创建：`apps/backend/src/auth/dto/auth-tokens.dto.ts`
- 修改：`apps/backend/src/auth/auth.controller.ts`

- [ ] **步骤 1：创建响应 DTO login-result.dto.ts**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/user.entity.js';

export class LoginResultDto {
  @ApiProperty({
    description: '访问令牌（JWT）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: '刷新令牌', example: 'MTIzNDU2Nzg5MGFiY2RlZg' })
  refreshToken: string;

  @ApiProperty({ description: '当前用户信息', type: User })
  user: User;
}
```

- [ ] **步骤 2：创建响应 DTO auth-tokens.dto.ts**

```ts
import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensDto {
  @ApiProperty({
    description: '访问令牌（JWT）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: '刷新令牌', example: 'MTIzNDU2Nzg5MGFiY2RlZg' })
  refreshToken: string;
}
```

- [ ] **步骤 3：注解 auth.controller.ts**

在现有导入基础上新增：

```ts
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { User as UserEntity } from '../users/user.entity.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { LoginResultDto } from './dto/login-result.dto.js';
```

类上加 `@ApiTags('auth')`，各端点按如下增补（`@Public()` 与 `@ApiBearerAuth()` 共存，前者是运行时守卫豁免、后者仅文档标记）：

```ts
  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册', description: '创建新账号并返回用户信息' })
  @ApiResponse({ status: 201, description: '注册成功', type: UserEntity })
  register(...)

  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录', description: '账号密码登录，返回 access/refresh 令牌' })
  @ApiResponse({ status: 201, description: '登录成功', type: LoginResultDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  login(...)

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌', description: '用 refresh token 换发新令牌对' })
  @ApiResponse({ status: 201, description: '换发成功', type: AuthTokensDto })
  @ApiResponse({ status: 401, description: '刷新令牌无效' })
  refresh(...)

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: '登出', description: '撤销当前 access 与 refresh 令牌' })
  @ApiResponse({ status: 201, description: '登出成功' })
  logout(...)

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前用户信息' })
  @ApiResponse({ status: 200, description: '返回当前登录用户', type: UserEntity })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  me(...)
```

> 保留原有 `@Public()` 装饰器与函数签名不变，只叠加 Swagger 装饰器。

- [ ] **步骤 4：验证响应 DTO 与 security 出现**

```bash
pnpm --filter @lucy/backend test:e2e test/docs.e2e-spec.ts
```

预期：`/auth/me` 的 `security` 含 `bearer`、`LoginResultDto` schema 断言转为 PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/auth/auth.controller.ts apps/backend/src/auth/dto/login-result.dto.ts apps/backend/src/auth/dto/auth-tokens.dto.ts
git commit -m "docs(backend): 注解 auth controller 并新增登录/令牌响应 DTO"
```

---

## 任务 6：注解 user.entity 与 app.controller

**文件：**

- 修改：`apps/backend/src/users/user.entity.ts`
- 修改：`apps/backend/src/app.controller.ts`

- [ ] **步骤 1：注解 user.entity.ts**

新增导入 `import { ApiProperty } from '@nestjs/swagger';`，为下列字段加 `@ApiProperty`。**`passwordHash` 与 `deletedAt` 不加注解**，使文档 schema 不含敏感字段（与 `toSharedUser` 剥离逻辑一致）：

```ts
  @ApiProperty({ description: '用户 ID' })
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ApiProperty({ description: '用户名', example: 'lucy' })
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  // passwordHash 不加 @ApiProperty

  @ApiProperty({ description: '昵称', nullable: true, example: 'Lucy' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  nickname: string | null;

  @ApiProperty({ description: '状态：1 正常', example: 1 })
  @Column({ type: 'smallint', default: 1 })
  status: number;

  @ApiProperty({ description: '创建时间', example: '2026-08-08T00:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间', example: '2026-08-08T00:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // deletedAt 不加 @ApiProperty
```

> 注意实体类名为 `User`，生成的 schema 键为 `components.schemas.User`。

- [ ] **步骤 2：注解 app.controller.ts**

新增导入 `import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';`，类加 `@ApiTags('system')`，`getHello` 叠加：

```ts
  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查', description: '返回服务运行状态' })
  @ApiResponse({ status: 200, description: '服务正常' })
  getHello(): string {
    return this.appService.getHello();
  }
```

- [ ] **步骤 3：验证 User schema**

```bash
pnpm --filter @lucy/backend test:e2e test/docs.e2e-spec.ts
```

预期：`User.properties.username` 存在、`passwordHash` 不存在 两条断言全部 PASS，整套 docs e2e 全绿。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/src/users/user.entity.ts apps/backend/src/app.controller.ts
git commit -m "docs(backend): 注解 user 实体与健康检查接口"
```

---

## 任务 7：全量验证与提交

**文件：** 无新增（仅验证）

- [ ] **步骤 1：后端全量验证**

```bash
pnpm --filter @lucy/backend typecheck
pnpm --filter @lucy/backend lint
pnpm --filter @lucy/backend test
pnpm --filter @lucy/backend test:e2e
```

预期：全部 PASS（单测覆盖门槛 80% 不受影响——新增测试在 `test/`，不含业务模块）。

> 若 `pnpm --filter @lucy/backend test` 因覆盖率门槛失败，检查 `vitest.config.ts` 排除项是否覆盖到新增文件。

- [ ] **步骤 2：真实启动冒烟（可选但推荐）**

```bash
pnpm --filter @lucy/backend dev
```

浏览器打开 `http://localhost:3000/docs`，确认 Scalar UI 渲染、`/docs-json` 返回原始 JSON、`/auth` 各接口有 Bearer 标识。完成后 Ctrl+C。

- [ ] **步骤 3：提交收尾**

```bash
git add apps/backend
git commit -m "feat(backend): 完成 Scalar API 文档模块"
```

> 注：pre-commit 会跑全仓 `pnpm typecheck`/`pnpm test`（turbo），可能较慢。若因与本次无关的改动阻塞提交，先与用户确认处理方式，不要擅自跳过钩子。工作区前端 `routeTree.gen.ts` 的 M 状态仅为换行符差异，不影响 typecheck，不需要处理。

---

## 自检

**规格覆盖度**（对照 `2026-08-08-scalar-docs-module-design.md`）：

- Section 1（DocsModule + setup + 路由）→ 任务 2/3
- Section 2（DTO / auth controller / app controller / entity 注解）→ 任务 4/5/6
- Section 3（e2e：dev 200、prod 404、/docs-json 路径）→ 任务 2 测试 + 各任务验证
- 依赖（@nestjs/swagger + @scalar/nestjs-api-reference）→ 任务 1

**占位符扫描**：无 TODO/待定，每个代码步骤含完整代码。

**类型一致性**：`apiReference`（v1.2.13 导出名，非 `ScalarApiReference`）、`LoginResultDto`/`AuthTokensDto`/`UserEntity` 命名在测试与实现间一致；`components.schemas.User` 来自实体类名 `User`。
