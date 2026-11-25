import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createE2eApp } from './e2e-auth.helper.js';

/**
 * 最外层冒烟：应用能被完整装配起来并响应根路由。
 *
 * 装配统一走 `createE2eApp`（cookieParser + URI 版本化，与 `main.ts` 一致）。
 * 此前这里自己 `createNestApplication()`，少了 cookieParser 与版本化，
 * 于是「生产路径上能跑、只有这个 spec 是老装配」的差异一直存在——
 * 根路由虽然不受影响，但多一份 bootstrap 就多一处会漏改的装配。
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<Server>;
  let server: Server;

  beforeAll(async () => {
    ({ app, server } = await createE2eApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', async () => {
    const res = await request(server).get('/').expect(200);
    expect(res.body).toEqual({
      code: 0,
      message: 'ok',
      data: 'Hello World!',
    });
  });
});
