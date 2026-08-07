# 后端 Scalar API 文档模块设计

日期：2026-08-08 分支：feature/auth-login

## 背景与目标

后端目前没有任何 OpenAPI/文档集成，接口只能靠读代码或手动请求。目标：

1. 引入 Scalar 渲染交互式 API 文档页，替代默认 Swagger UI（现代、可读性好）。
2. 文档能力封装为独立模块 `src/docs/`，所有文档配置集中维护。
3. 仅开发环境暴露，生产不泄露接口面。
4. 现有 controller + DTO 全量加 Swagger 注解，文档开箱即用。

## 决策记录

- **访问范围**：仅开发环境（`NODE_ENV !== 'production'`），生产为 no-op。
- **注解覆盖**：本次把现有 3 个 DTO + `auth` controller（5 端点）+ `app.controller` + `user.entity` 全部注解，文档开箱即用。
- **路由**：`/docs` 渲染 Scalar UI，`/docs-json` 暴露原始 OpenAPI JSON（供下载/CI 校验）。
- **封装形式**：`DocsModule` 提供静态 `setup(app)` 方法，由 `main.ts` 调用。原因：`SwaggerModule.createDocument` 需应用实例扫描路由，Nest 生命周期钩子拿不到 app，静态 setup 是官方 Scalar 集成推荐姿势。
- **不建模响应信封**：全局 `ApiResponseInterceptor` 包裹 `{code,message,data}`，文档只描述 data 负载，不建信封 schema（保持聚焦）；refresh cookie 仅在接口描述中文字说明。

## 新增依赖

- `@nestjs/swagger`（生成 OpenAPI 文档，Nest 11 兼容版本）
- `@scalar/nestjs-api-reference`（渲染 Scalar 参考 UI）

## Section 1：`src/docs/` 模块

```
src/docs/
  docs.module.ts   — DocsModule，含静态 setup(app)
```

`setup(app)` 逻辑：

```ts
static setup(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;
  const config = new DocumentBuilder()
    .setTitle('Lucy API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  app.use('/docs', ScalarApiReference({ content: document }));
  app.getHttpAdapter().get('/docs-json', (_req, res) => res.json(document));
}
```

- `/docs-json` 走 adapter 层，绕过全局 `ApiResponseInterceptor`，返回原始 OpenAPI JSON。
- `main.ts` 在 `bootstrap()` 中 `listen` 前插入 `DocsModule.setup(app)`。

## Section 2：Swagger 注解

- 3 个 DTO（`register`/`login`/`refresh`）：每个字段加 `@ApiProperty`（example/required/description）。
- `auth.controller`：类加 `@ApiTags('auth')`；5 端点加 `@ApiOperation` + `@ApiResponse`；`logout`/`me` 加 `@ApiBearerAuth()`。
- `app.controller`（getHello）：`@ApiTags('system')` + `@ApiOperation`。
- `user.entity`：字段加 `@ApiProperty`，让 `me`/`register` 返回体有真实 schema。

## Section 3：测试

新增 `test/docs.e2e-spec.ts`（沿用现有 e2e 约定，boot `AppModule` + supertest）：

- 非生产环境：`GET /docs` → 200 且返回 HTML；`GET /docs-json` → 200 且 JSON 含 `/auth/login` 路径。
- `NODE_ENV=production` 时 setup 为空操作：`GET /docs` → 404。

## 风险与取舍

- `@scalar/nestjs-api-reference` 为较新包，若 API 与当前版本有出入，以安装后的类型签名为准微调。
- `user.entity` 注解后 Swagger 依赖类反射，`ApiResponse({ type: UserEntity })` 即可引用，无需额外插件。
