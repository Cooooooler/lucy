import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';

/**
 * e2e 共用脚手架：应用 bootstrap + 注册/登录。
 *
 * 抽出来的理由：这几段此前在 `auth` / `users` / `knowledge` / `ai` 四个 spec 里逐字重复，
 * 注册登录的契约（密码规则、`account` 字段名、邮箱推导）一变就要改四处，漏改的那个 spec
 * 会静默用旧契约继续跑。
 */

/** 测试账号统一密码：只在注册/登录两处使用，集中定义避免各处手写 */
export const E2E_PASSWORD = 'Password1!';

/** 后端统一响应信封 */
export interface ApiBody<T> {
  code: number;
  message: string;
  data: T;
}

/** 登录响应体（各 e2e 共用的最小形状） */
export interface LoginData {
  accessToken: string;
  user: { id: string; role: string };
}

/**
 * 启动一个与生产同装配的 Nest 应用。
 * 含 `cookieParser`：刷新令牌经 HttpOnly cookie 读写，与 `main.ts` 保持一致。
 * @param configure 可选：对 TestingModuleBuilder 做额外装配（如 `.overrideProvider(...)`），
 *   让「带替身服务的应用」也走同一处 bootstrap，而不是再抄一份 cookieParser/init
 */
export async function createE2eApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<{
  app: INestApplication<Server>;
  server: Server;
  dataSource: DataSource;
}> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (configure ? configure(builder) : builder).compile();
  // 显式给 `createNestApplication` 带上泛型：否则是 `INestApplication<any>`，
  // `app.getHttpServer()` 会被推断成 any（命中 @typescript-eslint/no-unsafe-assignment）
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  app.use(cookieParser());
  await app.init();
  return { app, server: app.getHttpServer(), dataSource: app.get(DataSource) };
}

/** 登录已存在的测试账号 */
export async function login(
  server: Server,
  username: string,
): Promise<LoginData> {
  const res = await request(server)
    .post('/auth/login')
    .send({ account: username, password: E2E_PASSWORD })
    .expect(201);
  return (res.body as ApiBody<LoginData>).data;
}

/** 注册并登录一个测试账号 */
export async function registerAndLogin(
  server: Server,
  username: string,
): Promise<LoginData> {
  await request(server)
    .post('/auth/register')
    .send({
      username,
      email: `${username}@test.com`,
      password: E2E_PASSWORD,
    })
    .expect(201);
  return login(server, username);
}
