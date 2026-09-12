process.env.DB_NAME = 'lucy_test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { UserRole } from '../src/common/roles.js';
import { User } from '../src/users/user.entity.js';

interface ApiBody<T> {
  code: number;
  message: string;
  data: T;
}

interface LoginData {
  accessToken: string;
  user: { id: string; role: string };
}

async function login(server: Server, username: string): Promise<LoginData> {
  const res = await request(server)
    .post('/auth/login')
    .send({ account: username, password: 'Password1!' })
    .expect(201);
  return (res.body as ApiBody<LoginData>).data;
}

async function registerAndLogin(
  server: Server,
  username: string,
): Promise<LoginData> {
  await request(server)
    .post('/auth/register')
    .send({ username, email: `${username}@test.com`, password: 'Password1!' })
    .expect(201);
  return login(server, username);
}

describe('Users role (e2e)', () => {
  let app: INestApplication<Server>;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
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

  it('admin 改角色 403；superadmin 改角色 200 且即时生效；授 superadmin 被 DTO 拦 400', async () => {
    const server = app.getHttpServer();
    const dataSource = app.get(DataSource);
    const userRepo = dataSource.getRepository(User);

    const adminName = `e2e_admin_${suffix}`;
    const targetName = `e2e_target_${suffix}`;
    const superName = `e2e_root_${suffix}`;
    const adminReg = await registerAndLogin(server, adminName);
    const target = await registerAndLogin(server, targetName);
    await registerAndLogin(server, superName);
    // 注册只产出 user：直写 DB 提权构造 admin/superadmin 调用者（无提权接口是有意为之）
    await userRepo.update({ id: adminReg.user.id }, { role: UserRole.Admin });
    const superRow = await userRepo.findOneByOrFail({ username: superName });
    await userRepo.update({ id: superRow.id }, { role: UserRole.SuperAdmin });
    // 提权后重登：角色经 UserAccessService 回读，新 token 关联新角色快照
    const admin = await login(server, adminName);
    const superadmin = await login(server, superName);

    // admin 调用改角色：路由层 @Roles(SuperAdmin) 直接 403
    await request(server)
      .patch(`/users/${target.user.id}/role`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'admin' })
      .expect(403);

    // superadmin 授 superadmin：DTO 白名单 IsIn 拦下，400
    const superToken = superadmin.accessToken;
    await request(server)
      .patch(`/users/${target.user.id}/role`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ role: 'superadmin' })
      .expect(400);

    // superadmin 提 user → admin：200，返回体角色已变更
    const updated = await request(server)
      .patch(`/users/${target.user.id}/role`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ role: 'admin' })
      .expect(200);
    expect((updated.body as ApiBody<{ role: string }>).data.role).toBe('admin');

    // 角色即时生效：被提权者重登后列表接口放行（admin 可进原先 403 的列表）
    const targetRelogin = await login(server, targetName);
    const targetToken = targetRelogin.accessToken;
    await request(server)
      .get('/users')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(200);
  });
});
