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

interface ConversationPage {
  list: Record<string, unknown>[];
  nextCursor: string | null;
}

/**
 * 会话列表的真实 HTTP 端到端用例。
 *
 * 为什么必须有：本列表的排序键是**可变列** `updated_at`，失败模式是静默漏行/错页，
 * 而装配层单测用的是 stub 的 QueryBuilder（验不到真实 SQL、列名解析与毫秒精度）。
 * 这里比照 `knowledge.e2e-spec.ts` 的 sweep：真实 HTTP 逐页翻到末页，与直接查库得到的
 * 权威顺序 `(updated_at DESC, id DESC)` 逐元素比对；并把「翻页途中被更新的行会被跳过、
 * 但不重复」这一取舍钉成可回归的行为契约。
 */
describe('AI conversation keyset pagination (e2e)', () => {
  let app: INestApplication<Server>;
  let server: Server;
  let dataSource: DataSource;
  let token: string;
  let userId: string;
  const suffix = randomUUID().slice(0, 8);

  /** 列表项允许式白名单（多一个字段就该让断言失败） */
  const itemKeys = ['createdAt', 'id', 'model', 'title', 'updatedAt'];

  // 基准毫秒：5 条共享同一 updated_at（同毫秒并列，靠 id 决胜），另 4 条落在不同毫秒。
  // 列类型是 timestamptz(3)，因此这些毫秒值落库后原样保留。
  const tieTs = new Date('2026-06-06T06:06:06.600Z');
  const tieIds: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** 取一页（真实 HTTP） */
  async function fetchPage(
    limit: number,
    cursor: string | null,
  ): Promise<ConversationPage> {
    const query: Record<string, string> = { limit: String(limit) };
    if (cursor) query.cursor = cursor;
    const res = await request(server)
      .get('/v1/ai/conversations')
      .query(query)
      .set(auth())
      .expect(200);
    return (res.body as ApiBody<ConversationPage>).data;
  }

  /** 用游标逐页翻到末页，收集全部 id（与生产一致的真实 HTTP 调用） */
  async function sweep(limit: number): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 1000; i++) {
      const page = await fetchPage(limit, cursor);
      for (const item of page.list) {
        expect(Object.keys(item).sort()).toEqual(itemKeys);
        ids.push(item.id as string);
      }
      cursor = page.nextCursor;
      if (!cursor) return ids;
    }
    throw new Error('分页未收敛：nextCursor 始终非 null');
  }

  /** 直接查库得到同一语义下的权威顺序：本用户的会话按 (updated_at DESC, id DESC) */
  async function expectedOrder(): Promise<string[]> {
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM ai_conversations
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC`,
      [userId],
    );
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    ({ app, server, dataSource } = await createE2eApp());

    const login = await registerAndLogin(server, `e2e_ai_${suffix}`);
    token = login.accessToken;
    userId = login.user.id;

    // 直写 updated_at 精确制造「同毫秒并列」——走 ORM 拿不到可控的同毫秒。
    // createdAt 刻意与 updatedAt **不同序**（按插入序递增 1s，而 updatedAt 是另一套）：
    // 若排序键被误写成 created_at，下面的逐元素比对必须失败 —— 否则这个用例抓不到错列。
    for (let k = 0; k < 5; k++) tieIds.push(randomUUID());
    const tieSpecs = tieIds.map((id) => ({ id, updatedAt: tieTs }));
    const spreadSpecs = [1, 2, 3, 4].map((k) => ({
      id: randomUUID(),
      updatedAt: new Date(tieTs.getTime() + k * 1000),
    }));
    let seq = 0;
    for (const spec of [...tieSpecs, ...spreadSpecs]) {
      const createdAt = new Date(tieTs.getTime() - 600_000 + seq++ * 1000);
      await dataSource.query(
        `INSERT INTO ai_conversations (id, user_id, title, model, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [spec.id, userId, `e2e_ai_${suffix}`, createdAt, spec.updatedAt],
      );
    }
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM ai_conversations WHERE user_id = $1', [
      userId,
    ]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    await app.close();
  });

  it('limit=1/2/3 逐页翻到末页：无重复、无遗漏，与库中 (updated_at DESC, id DESC) 逐元素一致', async () => {
    const expected = await expectedOrder();
    expect(expected).toHaveLength(9);

    for (const limit of [1, 2, 3]) {
      const swept = await sweep(limit);
      expect(swept, `limit=${limit}`).toEqual(expected);
      expect(new Set(swept).size, `limit=${limit} 有重复`).toBe(swept.length);
    }
  });

  it('同毫秒并列靠 id 决胜：5 条同 updated_at 的行顺序与库中一致', async () => {
    const expected = await expectedOrder();
    const expectedTie = expected.filter((id) => tieIds.includes(id));
    const swept = await sweep(2);
    const sweptTie = swept.filter((id) => tieIds.includes(id));
    expect(sweptTie).toEqual(expectedTie);
    // 降序 + id 决胜：同毫秒组内必须是 id 降序
    expect(sweptTie).toEqual([...sweptTie].sort().reverse());
  });

  it('响应形状：只有 list + nextCursor（旧的 total/page/pageSize 已移除）', async () => {
    const res = await request(server)
      .get('/v1/ai/conversations')
      .set(auth())
      .expect(200);
    const body = res.body as ApiBody<ConversationPage>;
    expect(Object.keys(body.data).sort()).toEqual(['list', 'nextCursor']);
  });

  it('limit 超过 DTO 上界（100）直接 400，不落到查询层', async () => {
    await request(server)
      .get('/v1/ai/conversations')
      .query({ limit: '1000' })
      .set(auth())
      .expect(400);
  });

  it('翻页途中更新（改名）某会话：它被移到最前、本轮不再出现，且不重复', async () => {
    const expected = await expectedOrder();
    const first = await fetchPage(2, null);
    const firstIds = first.list.map((item) => item.id as string);
    // 选一条**尚未取到**的行，用真实 HTTP 改名（走 @UpdateDateColumn，updated_at 变为当前时间）
    const pending = expected.find((id) => !firstIds.includes(id));
    if (!pending) throw new Error('没有可用于「翻页途中更新」的候选行');
    await request(server)
      .patch(`/v1/ai/conversations/${pending}`)
      .set(auth())
      .send({ title: `renamed-${suffix}` })
      .expect(200);

    const collected = [...firstIds];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await fetchPage(2, cursor);
      collected.push(...page.list.map((item) => item.id as string));
      cursor = page.nextCursor;
    }

    // 不重复
    expect(new Set(collected).size).toBe(collected.length);
    // 但被更新时间「跳过」了：它已移到游标之前，本轮翻页取不到
    expect(collected).not.toContain(pending);
    // 重拉首页就能看到它（已顶到最前）
    const fresh = await fetchPage(2, null);
    expect(fresh.list.map((item) => item.id as string)).toContain(pending);
    expect((fresh.list[0] as { id: string }).id).toBe(pending);
  });

  // 放在最后：本用例会多造一条会话，前面的断言依赖初始的 9 条
  it('创建/改名返回与列表项同一份允许式契约（不含 messages / userId）', async () => {
    const created = await request(server)
      .post('/v1/ai/conversations')
      .set(auth())
      .send({})
      .expect(201);
    const createdItem = (created.body as ApiBody<Record<string, unknown>>).data;
    expect(Object.keys(createdItem).sort()).toEqual(itemKeys);
    // 服务端不 populate 关系，契约里就不该有它（拿实体当契约时会变成必填）
    expect(createdItem).not.toHaveProperty('messages');
    expect(createdItem).not.toHaveProperty('userId');

    const renamed = await request(server)
      .patch(`/v1/ai/conversations/${createdItem.id as string}`)
      .set(auth())
      .send({ title: `renamed-${suffix}` })
      .expect(200);
    const renamedItem = (renamed.body as ApiBody<Record<string, unknown>>).data;
    expect(Object.keys(renamedItem).sort()).toEqual(itemKeys);
    expect(renamedItem.title).toBe(`renamed-${suffix}`);
  });
});
