import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  type ApiBody,
  createE2eApp,
  registerAndLogin,
} from './e2e-auth.helper.js';

describe('ModelProvider CRUD & connection test (e2e)', () => {
  let app: INestApplication<Server>;
  let server: Server;
  let dataSource: DataSource;
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;
  const suffix = randomUUID().slice(0, 8);

  const createBody = {
    name: `mdl_${suffix}`,
    type: 'llm',
    vendor: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chat-completions',
    contextLength: 128000,
    apiKey: `sk-e2e-${suffix}-abcd`,
  };

  beforeAll(async () => {
    ({ app, server, dataSource } = await createE2eApp());
    ({
      accessToken: token,
      user: { id: userId },
    } = await registerAndLogin(server, `mde2e_a_${suffix}`));
    ({
      accessToken: otherToken,
      user: { id: otherUserId },
    } = await registerAndLogin(server, `mde2e_b_${suffix}`));
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM model_providers WHERE owner_id = $1', [
      userId,
    ]);
    await dataSource.query('DELETE FROM model_providers WHERE owner_id = $1', [
      otherUserId,
    ]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [otherUserId]);
    await app.close();
  });

  /** 创建响应体：显式带上 id，供路径模板拼接（避免 unknown 模板表达式告警） */
  type ModelItemData = { id: string } & Record<string, unknown>;

  async function createModel(): Promise<ModelItemData> {
    const res = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(201);
    return (res.body as ApiBody<ModelItemData>).data;
  }

  it('创建返回脱敏契约，且库中为密文', async () => {
    const data = await createModel();

    expect(data).toMatchObject({
      name: createBody.name,
      type: 'llm',
      vendor: 'openai',
      baseUrl: createBody.baseUrl,
      protocol: 'chat-completions',
      contextLength: 128000,
      apiKeyMasked: '••••••abcd',
    });
    // 明文与密文都不得出现在响应
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(createBody.apiKey);
    expect(data).not.toHaveProperty('apiKey');
    expect(data).not.toHaveProperty('apiKeyEncrypted');
    expect(data).not.toHaveProperty('apiKeyLast4');

    const rows = await dataSource.query<
      { api_key_encrypted: string; api_key_last4: string }[]
    >(
      'SELECT api_key_encrypted, api_key_last4 FROM model_providers WHERE id = $1',
      [data.id],
    );
    expect(rows[0]?.api_key_last4).toBe('abcd');
    expect(rows[0]?.api_key_encrypted).not.toContain(createBody.apiKey);
    expect(rows[0]?.api_key_encrypted.length).toBeGreaterThan(0);
  });

  it('列表只返回自己的模型，支持类型过滤', async () => {
    const res = await request(server)
      .get('/v1/model-providers')
      .query({ name: `mdl_${suffix}`, type: 'llm' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as ApiBody<{ list: { name: string }[] }>;
    expect(body.data.list.length).toBeGreaterThan(0);
    expect(body.data.list.every((m) => m.name.includes(suffix))).toBe(true);

    const noMatch = await request(server)
      .get('/v1/model-providers')
      .query({ type: 'tts' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((noMatch.body as ApiBody<{ list: unknown[] }>).data.list).toEqual(
      [],
    );
  });

  it('更新：省略 apiKey 保留原 key，改名称生效', async () => {
    const created = await createModel();

    const res = await request(server)
      .patch(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `renamed_${suffix}` })
      .expect(200);
    const updated = (res.body as ApiBody<Record<string, unknown>>).data;
    expect(updated.name).toBe(`renamed_${suffix}`);
    // 未传 apiKey → 尾号不变
    expect(updated.apiKeyMasked).toBe('••••••abcd');
  });

  it('属主隔离：他人一律 404', async () => {
    const created = await createModel();
    const id = created.id;

    await request(server)
      .get(`/v1/model-providers/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(server)
      .patch(`/v1/model-providers/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'hacked' })
      .expect(404);
    await request(server)
      .delete(`/v1/model-providers/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(server)
      .post(`/v1/model-providers/${id}/test-connection`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('连接测试：不可达地址返回 ok=false（200）', async () => {
    const created = await createModel();
    await request(server)
      .patch(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseUrl: 'http://127.0.0.1:1/v1' })
      .expect(200);

    const res = await request(server)
      .post(`/v1/model-providers/${created.id}/test-connection`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const result = (
      res.body as ApiBody<{ ok: boolean; message: string; detail: unknown }>
    ).data;
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    // 不泄漏底层主机/端口
    expect(result.message).not.toContain('127.0.0.1');
  });

  it('连接测试：不支持的类型返回 ok=false', async () => {
    const res = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...createBody, name: `tts_${suffix}`, type: 'tts' })
      .expect(201);
    const id = (res.body as ApiBody<{ id: string }>).data.id;

    const test = await request(server)
      .post(`/v1/model-providers/${id}/test-connection`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const result = (test.body as ApiBody<{ ok: boolean; message: string }>)
      .data;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('暂不支持');
  });

  it('创建 ollama 可省略 apiKey，非 ollama 缺失则 400', async () => {
    const res = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...createBody,
        name: `ollama_${suffix}`,
        vendor: 'ollama',
        // localhost 无 TLD：钉住 require_tld:false（内网/本地供应商地址必须能过校验）
        baseUrl: 'http://localhost:11434',
        apiKey: undefined,
      })
      .expect(201);
    const data = (res.body as ApiBody<Record<string, unknown>>).data;
    expect(data.vendor).toBe('ollama');
    expect(data.apiKeyMasked).toBe('');

    await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...createBody,
        name: `anthropic_${suffix}`,
        vendor: 'anthropic',
        apiKey: undefined,
      })
      .expect(400);
  });

  it('删除后详情 404', async () => {
    const created = await createModel();
    await request(server)
      .delete(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(server)
      .get(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('默认模型设置：保存、读取与整体替换清空', async () => {
    const created = await createModel();

    const saved = await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'llm', modelProviderId: created.id }] })
      .expect(200);
    const savedBody = saved.body as ApiBody<{
      defaults: { type: string; modelProviderId: string | null }[];
    }>;
    expect(
      savedBody.data.defaults.find((item) => item.type === 'llm')
        ?.modelProviderId,
    ).toBe(created.id);

    // 保存后重新读取必须能回显（GET 走 relation 派生类型，不能只信 PUT 的返回）
    const readBack = await request(server)
      .get('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (
        readBack.body as ApiBody<{
          defaults: { type: string; modelProviderId: string | null }[];
        }>
      ).data.defaults.find((item) => item.type === 'llm')?.modelProviderId,
    ).toBe(created.id);

    // 提交空值即清除
    const cleared = await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'llm', modelProviderId: null }] })
      .expect(200);
    expect(
      (
        cleared.body as ApiBody<{
          defaults: { type: string; modelProviderId: string | null }[];
        }>
      ).data.defaults.every((item) => item.modelProviderId === null),
    ).toBe(true);
  });

  it('默认模型设置：拒绝他人的模型与类型不匹配', async () => {
    const otherModel = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(createBody)
      .expect(201);
    const otherId = (otherModel.body as ApiBody<{ id: string }>).data.id;

    await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'llm', modelProviderId: otherId }] })
      .expect(400);

    const created = await createModel();
    await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'tts', modelProviderId: created.id }] })
      .expect(400);
  });

  it('默认模型的类型被修改后，该默认设置被清除', async () => {
    const created = await createModel();
    await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'llm', modelProviderId: created.id }] })
      .expect(200);

    // 默认项的类型由关联模型派生；改类型会让旧类型设置失效，必须清除而不是留成歧义行
    await request(server)
      .patch(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text-embedding' })
      .expect(200);

    const res = await request(server)
      .get('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as ApiBody<{
      defaults: { type: string; modelProviderId: string | null }[];
    }>;
    expect(
      body.data.defaults.every((item) => item.modelProviderId === null),
    ).toBe(true);
  });

  it('删除模型时级联清除其默认设置', async () => {
    const created = await createModel();
    await request(server)
      .put('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaults: [{ type: 'llm', modelProviderId: created.id }] })
      .expect(200);

    await request(server)
      .delete(`/v1/model-providers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(server)
      .get('/v1/model-providers/defaults')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as ApiBody<{
      defaults: { type: string; modelProviderId: string | null }[];
    }>;
    expect(
      body.data.defaults.find((item) => item.type === 'llm')?.modelProviderId,
    ).toBeNull();
  });
});
