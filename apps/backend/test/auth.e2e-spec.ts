process.env.DB_NAME = 'lucy_test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

interface ApiBody<T> {
  code: number;
  message: string;
  data: T;
}

interface TokenData {
  accessToken: string;
  refreshToken: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<Server>;
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
    const loginBody = login.body as ApiBody<TokenData>;
    expect(loginBody.code).toBe(0);
    const accessToken = loginBody.data.accessToken;
    const refreshToken = loginBody.data.refreshToken;

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meBody = me.body as ApiBody<{ username: string }>;
    expect(meBody.data.username).toBe(username);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    const refreshedBody = refreshed.body as ApiBody<TokenData>;
    expect(refreshedBody.data.accessToken).toBeTruthy();

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
