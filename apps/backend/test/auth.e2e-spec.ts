import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { User } from '../src/users/user.entity.js';
import { type ApiBody, createE2eApp, E2E_PASSWORD } from './e2e-auth.helper.js';

interface TokenData {
  accessToken: string;
  refreshToken: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<Server>;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    ({ app } = await createE2eApp());
  });

  afterAll(async () => {
    // 自清理：删掉本用例注册的账号（按 username 前缀），不断言行数
    const dataSource = app.get(DataSource);
    await dataSource
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :prefix', { prefix: `e2e\\_%${suffix}` })
      .execute();
    await app.close();
  });

  it('注册 → 登录 → me → 刷新 → 登出 全链路', async () => {
    const username = `e2e_${suffix}`;
    const email = `${username}@test.com`;
    const server = app.getHttpServer();

    await request(server)
      .post('/v1/auth/register')
      .send({ username, email, password: E2E_PASSWORD })
      .expect(201);

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ account: username, password: E2E_PASSWORD })
      .expect(201);
    const loginBody = login.body as ApiBody<TokenData>;
    expect(loginBody.code).toBe(0);
    const accessToken = loginBody.data.accessToken;
    // refresh 令牌经 HttpOnly set-cookie 下发，从响应头取出后显式携带
    const refreshCookie = (login.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

    const me = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meBody = me.body as ApiBody<{ username: string }>;
    expect(meBody.data.username).toBe(username);

    const refreshed = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(201);
    const refreshedBody = refreshed.body as ApiBody<TokenData>;
    expect(refreshedBody.data.accessToken).toBeTruthy();

    await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie)
      .expect(201);

    // 登出后 access 立即失效
    await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // 登出后整个 refresh 家族被吊销，旧 cookie 立即失效
    await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });

  // 同一个邮箱在库中只能有一行：注册写入归一为小写，登录对含 @ 的 account 也归一，
  // 否则大小写变体可注册出重复账号、且本人用小写登录会 401
  it('邮箱大小写不敏感：注册归一为小写、变体不可重复注册、小写可登录', async () => {
    const username = `e2e_case_${suffix}`;
    const email = `Case_${suffix}@Test.COM`;
    const server = app.getHttpServer();

    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ username, email, password: E2E_PASSWORD })
      .expect(201);
    const registeredBody = registered.body as ApiBody<{ email: string }>;
    expect(registeredBody.data.email).toBe(email.toLowerCase());

    // 仅大小写不同的邮箱视为同一个账号
    await request(server)
      .post('/v1/auth/register')
      .send({
        username: `e2e_dup_${suffix}`,
        email: email.toLowerCase(),
        password: E2E_PASSWORD,
      })
      .expect(409);

    // 本人改用小写邮箱登录（修复前这里 401）
    await request(server)
      .post('/v1/auth/login')
      .send({ account: email.toLowerCase(), password: E2E_PASSWORD })
      .expect(201);

    // 用户把注册时填写的混合大小写邮箱原样粘贴回来也应能登录
    // （复制粘贴是真实路径；归一只要在 DTO 或 findByEmail 任一处丢失，这里就会 401）
    await request(server)
      .post('/v1/auth/login')
      .send({ account: email, password: E2E_PASSWORD })
      .expect(201);
  });

  // 应用层归一之外，schema 也拒绝混合大小写：绕过 UsersService.create 的写入
  // （脚本 / 直接 SQL / 将来的改邮箱入口）同样插不进去
  it('users.email 的 CHECK 约束拒绝混合大小写', async () => {
    const dataSource = app.get(DataSource);
    await expect(
      dataSource.query(
        `INSERT INTO "users" ("username", "email", "password_hash") VALUES ($1, $2, $3)`,
        [`e2e_chk_${suffix}`, `Chk_${suffix}@Test.COM`, 'hash'],
      ),
    ).rejects.toThrow(/CHK_/);
  });
});
