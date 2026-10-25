import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { DocumentListResultDto } from '../src/knowledge/dto/knowledge-list-result.dto.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from '../src/knowledge/entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../src/knowledge/entities/knowledge-document.entity.js';
import { KnowledgeDocumentService } from '../src/knowledge/knowledge-document.service.js';
import { KnowledgeService } from '../src/knowledge/knowledge.service.js';
import {
  type ApiBody,
  createE2eApp,
  registerAndLogin,
} from './e2e-auth.helper.js';

/**
 * 删除本用例造出的全部数据（含 likes / documents / files / 知识库 / 用户），
 * 按外键依赖顺序清理，保证用例可重复执行、不影响库中其它数据。
 */
async function deleteTestUserData(
  dataSource: DataSource,
  userId: string,
): Promise<void> {
  await dataSource.query('DELETE FROM knowledge_likes WHERE user_id = $1', [
    userId,
  ]);
  await dataSource.query(
    'DELETE FROM knowledge_documents WHERE knowledge_base_id IN (SELECT id FROM knowledge_bases WHERE owner_id = $1)',
    [userId],
  );
  await dataSource.query('DELETE FROM files WHERE owner_id = $1', [userId]);
  await dataSource.query('DELETE FROM knowledge_bases WHERE owner_id = $1', [
    userId,
  ]);
  await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
}

describe('Knowledge pagination (keyset + page) & serialization (e2e)', () => {
  let app: INestApplication<Server>;
  let server: Server;
  let dataSource: DataSource;
  let token: string;
  let userId: string;
  /** 第二个用户：仅用于「重排模型属主校验」用例 */
  let otherToken: string;
  let otherUserId: string;
  const suffix = randomUUID().slice(0, 8);
  /**
   * 用名称里唯一前缀把「本用例造的数据」从库里其它数据中隔离出来：list 的 `name`
   * 过滤（`name ILIKE %token%`）会让分页只覆盖本用例自己的行，从而对「库中已有
   * 大量其它知识库」的库（本地 dev 库有 ~395 条）也安全——既不误算进断言，
   * 也不会把整套列表翻页打到 /user 限流（100 req/min）上。
   * 注意：这里走的是 list 的默认分支（owned OR public）+ name 过滤，keyset 谓词与排序
   * 与生产路径完全一致。
   */
  const scopeToken = `kbe2e_${suffix}`;

  // 基准毫秒：6 条共享同一 created_at（同毫秒并列），其余落在不同毫秒。
  const tieTs = new Date('2026-05-05T05:05:05.500Z');
  const tieIds: string[] = [];
  const tieIdSet = new Set<string>();

  /** 文档列表契约用：承载文档的那个知识库与文档 id（在 beforeAll 里落库） */
  let docsKbId: string;
  let docRowId: string;
  /** 文档列表**分页**用：另一个知识库，装 6 条同毫秒 + 4 条不同毫秒的文档 */
  let docsPageKbId: string;

  const kbListKeys = [
    'id',
    'ownerId',
    'visibility',
    'name',
    'description',
    'retrievalMode',
    'topK',
    'scoreThresholdEnabled',
    'scoreThreshold',
    'semanticWeight',
    'rerankModelId',
    'createdAt',
    'updatedAt',
    'likeCount',
    'isLiked',
  ].sort();

  /** 用游标逐页翻到末页，收集全部 id（与生产一致的真实 HTTP 调用）。 */
  async function sweep(limit: number): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 1000; i++) {
      const query: Record<string, string> = {
        limit: String(limit),
        name: scopeToken,
      };
      if (cursor) query.cursor = cursor;
      const res = await request(server)
        .get('/v1/knowledge')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as ApiBody<{
        list: { id: string }[];
        nextCursor: string | null;
      }>;
      for (const item of body.data.list) ids.push(item.id);
      cursor = body.data.nextCursor;
      if (!cursor) return ids;
    }
    throw new Error('分页未收敛：nextCursor 始终非 null');
  }

  /**
   * 直接查库得到同一语义下的权威顺序：默认分支（owned OR public）+ name 过滤，
   * 按 (created_at DESC, id DESC)。用于与 HTTP 分页结果逐元素比对。
   */
  async function expectedOrder(): Promise<string[]> {
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM knowledge_bases
       WHERE (owner_id = $1 OR visibility = 'public')
         AND name ILIKE $2
       ORDER BY created_at DESC, id DESC`,
      [userId, `%${scopeToken}%`],
    );
    return rows.map((row) => row.id);
  }

  /**
   * 用页码逐页翻完某个知识库的**文档**列表，收集全部 id 与 total。
   * 走真实 HTTP，顺带断言列表项不带解析全文、带文件元数据（列投影 + 分页 + join files 一起验）。
   */
  async function sweepDocuments(
    pageSize: number,
  ): Promise<{ ids: string[]; total: number }> {
    const ids: string[] = [];
    for (let page = 1; page <= 1000; page++) {
      const res = await request(server)
        .get(`/v1/knowledge/${docsPageKbId}/documents`)
        .query({ page: String(page), pageSize: String(pageSize) })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as ApiBody<{
        list: Record<string, unknown>[];
        total: number;
        page: number;
        pageSize: number;
      }>;
      // 响应回显本次分页参数：契约里的 page/pageSize 必须与请求一致
      expect(body.data.page).toBe(page);
      expect(body.data.pageSize).toBe(pageSize);
      for (const item of body.data.list) {
        expect(item).not.toHaveProperty('content');
        expect(item).not.toHaveProperty('file');
        expect(typeof item.originalName).toBe('string');
        expect(typeof item.size).toBe('number');
        ids.push(item.id as string);
      }
      // 末页（不足一页）即收敛：total 从这一页取即可，翻页过程中它不会变
      if (body.data.list.length < pageSize) {
        return { ids, total: body.data.total };
      }
    }
    throw new Error('文档分页未收敛：页码翻到 1000 页仍未取完');
  }

  /** 文档列表的权威顺序（与生产路径同一语义）：(created_at DESC, id DESC) */
  async function expectedDocumentOrder(): Promise<string[]> {
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM knowledge_documents
        WHERE knowledge_base_id = $1
        ORDER BY created_at DESC, id DESC`,
      [docsPageKbId],
    );
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    ({ app, server, dataSource } = await createE2eApp());

    const login = await registerAndLogin(server, `e2e_kb_${suffix}`);
    token = login.accessToken;
    userId = login.user.id;
    const other = await registerAndLogin(server, `e2e_kb_other_${suffix}`);
    otherToken = other.accessToken;
    otherUserId = other.user.id;

    // 独立测试数据：6 条同毫秒并列 + 4 条不同毫秒，均为该测试用户私有的知识库。
    // 直写 created_at（绕过 CreateDateColumn 的 now()），以精确制造同毫秒并列。
    const specs: { name: string; createdAt: Date }[] = [];
    for (let k = 0; k < 6; k++) {
      specs.push({ name: `${scopeToken}-tie-${k}`, createdAt: tieTs });
    }
    specs.push({
      name: `${scopeToken}-newer-2s`,
      createdAt: new Date(tieTs.getTime() + 2000),
    });
    specs.push({
      name: `${scopeToken}-newer-1s`,
      createdAt: new Date(tieTs.getTime() + 1000),
    });
    specs.push({
      name: `${scopeToken}-older-1s`,
      createdAt: new Date(tieTs.getTime() - 1000),
    });
    specs.push({
      name: `${scopeToken}-older-2s`,
      createdAt: new Date(tieTs.getTime() - 2000),
    });

    for (const spec of specs) {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO knowledge_bases (id, owner_id, visibility, name, description, created_at, updated_at)
         VALUES ($1, $2, 'private', $3, $4, $5, $5)`,
        [id, userId, spec.name, `${spec.name}-描述`, spec.createdAt],
      );
      if (spec.name.includes('-tie-')) {
        tieIds.push(id);
        tieIdSet.add(id);
      }
    }

    // 文档列表契约：给其中一个知识库造一条带解析全文的文档（files → knowledge_documents）
    docsKbId = tieIds[0];
    docRowId = randomUUID();
    const fileRowId = randomUUID();
    await dataSource.query(
      `INSERT INTO files (id, owner_id, original_name, ext, mime, size, key, hash, storage, created_at, updated_at)
       VALUES ($1, $2, 'a.txt', '.txt', 'text/plain', 12, $3, $4, 'local', $5, $5)`,
      [fileRowId, userId, `kb-e2e/${fileRowId}.txt`, 'a'.repeat(64), tieTs],
    );
    await dataSource.query(
      `INSERT INTO knowledge_documents (id, knowledge_base_id, file_id, title, content, created_at, updated_at)
       VALUES ($1, $2, $3, '文档标题', '正文内容', $4, $4)`,
      [docRowId, docsKbId, fileRowId, tieTs],
    );

    // 文档列表的页码分页：另起一个知识库承载 6 条同毫秒 + 4 条不同毫秒的文档。
    // 单独一个库是为了不影响上面那条「列表做列投影」用例对 list[0]（'文档标题'）的断言。
    docsPageKbId = tieIds[1];
    const docSpecs: { title: string; createdAt: Date }[] = [];
    for (let k = 0; k < 6; k++) {
      docSpecs.push({ title: `doc-tie-${k}`, createdAt: tieTs });
    }
    docSpecs.push({
      title: 'doc-newer-2s',
      createdAt: new Date(tieTs.getTime() + 2000),
    });
    docSpecs.push({
      title: 'doc-newer-1s',
      createdAt: new Date(tieTs.getTime() + 1000),
    });
    docSpecs.push({
      title: 'doc-older-1s',
      createdAt: new Date(tieTs.getTime() - 1000),
    });
    docSpecs.push({
      title: 'doc-older-2s',
      createdAt: new Date(tieTs.getTime() - 2000),
    });

    for (const spec of docSpecs) {
      const docId = randomUUID();
      const fileId = randomUUID();
      await dataSource.query(
        `INSERT INTO files (id, owner_id, original_name, ext, mime, size, key, hash, storage, created_at, updated_at)
         VALUES ($1, $2, 'a.txt', '.txt', 'text/plain', 12, $3, $4, 'local', $5, $5)`,
        [
          fileId,
          userId,
          `kb-e2e/${fileId}.txt`,
          'a'.repeat(64),
          spec.createdAt,
        ],
      );
      await dataSource.query(
        `INSERT INTO knowledge_documents (id, knowledge_base_id, file_id, title, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $5)`,
        [docId, docsPageKbId, fileId, spec.title, spec.createdAt],
      );
    }
  });

  afterAll(async () => {
    await deleteTestUserData(dataSource, userId);
    await deleteTestUserData(dataSource, otherUserId);
    await app.close();
  });

  it('limit=1 逐页翻到末页：无重复、无遗漏，与库中 (created_at DESC, id DESC) 逐元素一致', async () => {
    const ids = await sweep(1);
    const expected = await expectedOrder();
    expect(ids).toEqual(expected);
    // 无重复：翻页没有把同一行返回两次
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('limit=2 逐页翻到末页：同样无重复、无遗漏、与库中顺序一致', async () => {
    const ids = await sweep(2);
    const expected = await expectedOrder();
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('同毫秒并列组（6 条共享 created_at）靠 id 决胜被完整取回', async () => {
    const ids = await sweep(1);
    const expected = await expectedOrder();
    const groupSeen = ids.filter((id) => tieIdSet.has(id));
    const groupExpected = expected.filter((id) => tieIdSet.has(id));
    // 6 条一条不漏，且相对顺序与库一致（同毫秒下按 id DESC 决胜，全序无跳行）
    expect(groupSeen).toHaveLength(6);
    expect(new Set(groupSeen).size).toBe(6);
    expect(groupSeen).toEqual(groupExpected);
  });

  it('伪造游标：i 非 UUID / 非法字符集 / 超长 / 非 JSON → 400', async () => {
    const auth = `Bearer ${token}`;
    // i 不是 UUID（字符集与长度合法，能进到 decodeCursor 才被拦）
    const nonUuidCursor = Buffer.from(
      JSON.stringify({ t: tieTs.toISOString(), i: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    await request(server)
      .get('/v1/knowledge')
      .query({ limit: '2', cursor: nonUuidCursor })
      .set('Authorization', auth)
      .expect(400);
    // 非法字符集（base64url 之外）
    await request(server)
      .get('/v1/knowledge')
      .query({ cursor: 'not-a-cursor!!' })
      .set('Authorization', auth)
      .expect(400);
    // 超长（> 512）
    await request(server)
      .get('/v1/knowledge')
      .query({ cursor: 'a'.repeat(600) })
      .set('Authorization', auth)
      .expect(400);
    // 合法 base64url 字符集，但不是合法 JSON
    await request(server)
      .get('/v1/knowledge')
      .query({ cursor: 'aaaaaaaa' })
      .set('Authorization', auth)
      .expect(400);
  });

  it('POST /knowledge 响应被序列化白名单过滤：不含 owner，字段集与契约一致', async () => {
    const res = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `${scopeToken}-created`, description: 'd' })
      .expect(201);
    const item = (res.body as ApiBody<Record<string, unknown>>).data;
    expect(item).not.toHaveProperty('owner');
    // 与 get/list/update 完全同一套字段（含查询期计算的 likeCount/isLiked）：
    // 此前 create 少这两个字段，导致同一实体在不同端点有两种形状
    expect(Object.keys(item).sort()).toEqual(kbListKeys);
    expect(item.ownerId).toBe(userId);
    expect(item.name).toBe(`${scopeToken}-created`);
    expect(item.likeCount).toBe(0);
    expect(item.isLiked).toBe(false);
    // 未提供检索设置时落默认值（现存知识库的迁移回填口径与此一致）
    expect(item).toMatchObject({
      retrievalMode: 'fulltext',
      topK: 5,
      scoreThresholdEnabled: false,
      scoreThreshold: 0,
      semanticWeight: 50,
      rerankModelId: null,
    });
  });

  it('检索设置创建后不可改：PATCH 带这些字段被 400（forbidNonWhitelisted）', async () => {
    const auth = `Bearer ${token}`;
    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({
        name: `${scopeToken}-retrieval`,
        description: 'd',
        retrievalMode: 'hybrid',
        topK: 8,
        scoreThresholdEnabled: true,
        scoreThreshold: 0.35,
        semanticWeight: 70,
      })
      .expect(201);
    const item = (created.body as ApiBody<Record<string, unknown>>).data;
    expect(item).toMatchObject({
      retrievalMode: 'hybrid',
      topK: 8,
      scoreThresholdEnabled: true,
      scoreThreshold: 0.35,
      semanticWeight: 70,
    });
    const id = item.id as string;

    for (const patch of [
      { retrievalMode: 'vector' },
      { topK: 10 },
      { scoreThresholdEnabled: false },
      { scoreThreshold: 0.5 },
      { semanticWeight: 30 },
      { rerankModelId: null },
    ]) {
      await request(server)
        .patch(`/v1/knowledge/${id}`)
        .set('Authorization', auth)
        .send(patch)
        .expect(400);
    }
  });

  it('重排模型校验：指向他人或非 rerank 的模型返回 400，且知识库未创建', async () => {
    const auth = `Bearer ${token}`;
    const modelBody = {
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'chat-completions',
      contextLength: 8192,
      apiKey: `sk-e2e-${suffix}-abcd`,
    };
    // 自己的 llm 模型（类型不符）
    const llm = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', auth)
      .send({ ...modelBody, name: `llm_${suffix}`, type: 'llm' })
      .expect(201);
    const llmId = (llm.body as ApiBody<{ id: string }>).data.id;

    // 他人的 rerank 模型（属主不符）
    const other = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...modelBody, name: `rerank_other_${suffix}`, type: 'rerank' })
      .expect(201);
    const otherId = (other.body as ApiBody<{ id: string }>).data.id;

    for (const rerankModelId of [llmId, otherId]) {
      await request(server)
        .post('/v1/knowledge')
        .set('Authorization', auth)
        .send({
          name: `${scopeToken}-bad-rerank`,
          description: 'd',
          rerankModelId,
        })
        .expect(400);
    }

    const list = await request(server)
      .get('/v1/knowledge')
      .set('Authorization', auth)
      .query({ name: `${scopeToken}-bad-rerank` })
      .expect(200);
    expect((list.body as ApiBody<{ list: unknown[] }>).data.list).toHaveLength(
      0,
    );
  });

  it('删除重排模型后知识库的 rerankModelId 置空（同事务清理 + FK 兜底）', async () => {
    const auth = `Bearer ${token}`;
    const model = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', auth)
      .send({
        name: `rerank_${suffix}`,
        type: 'rerank',
        vendor: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'chat-completions',
        contextLength: 8192,
        apiKey: `sk-e2e-${suffix}-abcd`,
      })
      .expect(201);
    const rerankId = (model.body as ApiBody<{ id: string }>).data.id;

    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({
        name: `${scopeToken}-rerank-ref`,
        description: 'd',
        rerankModelId: rerankId,
      })
      .expect(201);
    const kb = (created.body as ApiBody<Record<string, unknown>>).data;
    expect(kb.rerankModelId).toBe(rerankId);

    await request(server)
      .delete(`/v1/model-providers/${rerankId}`)
      .set('Authorization', auth)
      .expect(200);

    const detail = await request(server)
      .get(`/v1/knowledge/${String(kb.id)}`)
      .set('Authorization', auth)
      .expect(200);
    expect(
      (detail.body as ApiBody<Record<string, unknown>>).data.rerankModelId,
    ).toBeNull();
  });

  it('重排模型被改成其他类型后，知识库引用在同一事务里被清空', async () => {
    const auth = `Bearer ${token}`;
    const model = await request(server)
      .post('/v1/model-providers')
      .set('Authorization', auth)
      .send({
        name: `rerank-type-${suffix}`,
        type: 'rerank',
        vendor: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'chat-completions',
        contextLength: 8192,
        apiKey: `sk-e2e-${suffix}-abcd`,
      })
      .expect(201);
    const rerankId = (model.body as ApiBody<{ id: string }>).data.id;

    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({
        name: `${scopeToken}-rerank-type`,
        description: 'd',
        rerankModelId: rerankId,
      })
      .expect(201);
    const kbId = (created.body as ApiBody<{ id: string }>).data.id;

    await request(server)
      .patch(`/v1/model-providers/${rerankId}`)
      .set('Authorization', auth)
      .send({ type: 'llm' })
      .expect(200);

    const detail = await request(server)
      .get(`/v1/knowledge/${kbId}`)
      .set('Authorization', auth)
      .expect(200);
    expect(
      (detail.body as ApiBody<Record<string, unknown>>).data.rerankModelId,
    ).toBeNull();
  });

  it('文档列表页码分页：同毫秒按 id 决胜、逐页不重不漏（真实 SQL + 列投影 + join files）', async () => {
    const expected = await expectedDocumentOrder();
    expect(expected).toHaveLength(10);

    // pageSize 取 1/2/3：1 与 2 会落在同毫秒并列组内部（排序必须用 id 决胜），3 覆盖跨页裁剪
    for (const pageSize of [1, 2, 3]) {
      const { ids, total } = await sweepDocuments(pageSize);
      expect(ids, `pageSize=${pageSize}`).toEqual(expected);
      // 无重复：翻页没有把同一行返回两次
      expect(new Set(ids).size).toBe(ids.length);
      expect(total).toBe(expected.length);
    }
  });

  it('文档列表页码越界：返回空 list，total 不变', async () => {
    const res = await request(server)
      .get(`/v1/knowledge/${docsPageKbId}/documents`)
      .query({ page: '99', pageSize: '3' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as ApiBody<{ list: unknown[]; total: number }>;
    expect(body.data.list).toEqual([]);
    expect(body.data.total).toBe(10);
  });

  it('文档列表做列投影：不含解析全文 content，带文件元数据；详情才返回 content', async () => {
    const auth = `Bearer ${token}`;

    const list = await request(server)
      .get(`/v1/knowledge/${docsKbId}/documents`)
      .set('Authorization', auth)
      .expect(200);
    const item = (list.body as ApiBody<{ list: Record<string, unknown>[] }>)
      .data.list[0];
    expect(item.title).toBe('文档标题');
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('file');
    // 文件元数据来自 join 的 files 表（不是关系对象）
    expect(item.originalName).toBe('a.txt');
    expect(item.ext).toBe('.txt');
    expect(item.mime).toBe('text/plain');
    expect(item.size).toBe(12);
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'knowledgeBaseId',
        'fileId',
        'title',
        'originalName',
        'ext',
        'mime',
        'size',
        'createdAt',
        'updatedAt',
      ].sort(),
    );

    const detail = await request(server)
      .get(`/v1/knowledge/${docsKbId}/documents/${docRowId}`)
      .set('Authorization', auth)
      .expect(200);
    const detailItem = (detail.body as ApiBody<Record<string, unknown>>).data;
    expect(detailItem.content).toBe('正文内容');
    // 详情与列表同一套文件元数据（详情 = 列表 + content）
    expect(detailItem.originalName).toBe('a.txt');
    expect(detailItem.size).toBe(12);
  });

  it('GET /knowledge/:id、PATCH /knowledge/:id 与列表项同形且不含 owner', async () => {
    const auth = `Bearer ${token}`;
    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({ name: `${scopeToken}-get`, description: 'd' })
      .expect(201);
    const id = (created.body as ApiBody<{ id: string }>).data.id;

    const detail = await request(server)
      .get(`/v1/knowledge/${id}`)
      .set('Authorization', auth)
      .expect(200);
    const detailItem = (detail.body as ApiBody<Record<string, unknown>>).data;
    expect(detailItem).not.toHaveProperty('owner');
    expect(Object.keys(detailItem).sort()).toEqual(kbListKeys);

    const patched = await request(server)
      .patch(`/v1/knowledge/${id}`)
      .set('Authorization', auth)
      .send({ name: `${scopeToken}-get-patched` })
      .expect(200);
    const patchedItem = (patched.body as ApiBody<Record<string, unknown>>).data;
    expect(patchedItem).not.toHaveProperty('owner');
    expect(Object.keys(patchedItem).sort()).toEqual(kbListKeys);
    expect(patchedItem.name).toBe(`${scopeToken}-get-patched`);

    // 用 name 过滤把列表收敛到本用例自己的行（避免拉爆 395 行 dev 数据）
    const list = await request(server)
      .get('/v1/knowledge')
      .query({ name: scopeToken })
      .set('Authorization', auth)
      .expect(200);
    const items = (list.body as ApiBody<{ list: Record<string, unknown>[] }>)
      .data.list;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).not.toHaveProperty('owner');
      expect(Object.keys(item).sort()).toEqual(kbListKeys);
    }
  });

  it('上传文档：中文文件名按 UTF-8 解码（multer 默认 latin1 会解成乱码）', async () => {
    const auth = `Bearer ${token}`;
    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({ name: `${scopeToken}-upload`, description: 'd' })
      .expect(201);
    const uploadKbId = (created.body as ApiBody<{ id: string }>).data.id;

    try {
      const res = await request(server)
        .post(`/v1/knowledge/${uploadKbId}/documents`)
        .set('Authorization', auth)
        // form-data 以 UTF-8 原样写 filename（不带 filename*），正是浏览器与前端 FormData 的行为
        .attach('file', Buffer.from('正文内容', 'utf8'), '产品文档.md')
        .expect(201);
      const doc = (res.body as ApiBody<{ originalName: string; title: string }>)
        .data;
      expect(doc.originalName).toBe('产品文档.md');
      expect(doc.title).toBe('产品文档');
    } finally {
      // 级联删除知识库：文档行、文件行与已落盘的底层文件一并清理
      await request(server)
        .delete(`/v1/knowledge/${uploadKbId}`)
        .set('Authorization', auth)
        .expect(200);
    }
  });
});

/**
 * 序列化白名单的强证明：真实 HTTP + 全局 JwtAuthGuard + 控制器级 ClassSerializerInterceptor，
 * 但把 KnowledgeService 换成「返回值里把内部关系对象填充成哨兵值」的桩。
 * 若 @Exclude 失效，哨兵值会出现在响应体里——这里断言它绝不出现在任何端点上。
 */
describe('Knowledge serialization strips populated internal relations (e2e)', () => {
  let app: INestApplication<Server>;
  let server: Server;
  let dataSource: DataSource;
  let token: string;
  let userId: string;
  const suffix = randomUUID().slice(0, 8);

  const kbId = randomUUID();
  const docId = randomUUID();
  const fileId = randomUUID();
  const stamp = new Date('2026-05-05T05:05:05.500Z');

  const kbWithRelations = Object.assign(new KnowledgeBase(), {
    id: kbId,
    ownerId: randomUUID(),
    visibility: KnowledgeBaseVisibility.Private,
    name: 'with-relations',
    description: 'd',
    createdAt: stamp,
    updatedAt: stamp,
    likeCount: 2,
    isLiked: true,
    owner: {
      id: randomUUID(),
      username: 'SENTINEL_OWNER',
      passwordHash: 'SENTINEL_HASH',
    },
  });

  const docWithRelations = Object.assign(new KnowledgeDocument(), {
    id: docId,
    knowledgeBaseId: kbId,
    fileId,
    title: 'doc',
    content: 'body',
    createdAt: stamp,
    updatedAt: stamp,
    knowledgeBase: kbWithRelations,
    file: { id: fileId, key: 'SENTINEL_STORAGE_KEY', hash: 'SENTINEL_HASH' },
  });

  /**
   * 列表项桩：真实服务对列表做列投影 + 映射，本就不带 content，
   * 这里仍挂上内部关系，用来验证「列表路径也受 @Exclude 保护」。
   */
  const docListItemWithRelations = Object.assign(new KnowledgeDocument(), {
    id: docId,
    knowledgeBaseId: kbId,
    fileId,
    title: 'doc',
    createdAt: stamp,
    updatedAt: stamp,
    knowledgeBase: kbWithRelations,
    file: { id: fileId, key: 'SENTINEL_STORAGE_KEY', hash: 'SENTINEL_HASH' },
  });

  // 直接返回（非 async）：避免 @typescript-eslint/require-await；Nest 接受裸值返回
  const stub = {
    create: () => kbWithRelations,
    list: () => ({ list: [kbWithRelations], nextCursor: null }),
    get: () => kbWithRelations,
  };

  /**
   * 文档端点桩：返回类型**从契约派生**（`DocumentListResultDto` 去掉 list 元素类型），
   * 而不是手抄一份字面量——契约增删 envelope 键时会在编译期打断这里，桩不会静默变成过期副本。
   * list 元素仍用实体，因为本用例要验证实体上的内部关系被 `@Exclude` 剔除。
   */
  const docStub: {
    listDocuments: () => Omit<DocumentListResultDto, 'list'> & {
      list: KnowledgeDocument[];
    };
    getDocument: () => KnowledgeDocument;
  } = {
    listDocuments: () => ({
      list: [docListItemWithRelations],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    getDocument: () => docWithRelations,
  };

  beforeAll(async () => {
    ({ app, server, dataSource } = await createE2eApp((builder) =>
      builder
        .overrideProvider(KnowledgeService)
        .useValue(stub)
        .overrideProvider(KnowledgeDocumentService)
        .useValue(docStub),
    ));

    const login = await registerAndLogin(server, `e2e_ser_${suffix}`);
    token = login.accessToken;
    userId = login.user.id;
  });

  afterAll(async () => {
    await deleteTestUserData(dataSource, userId);
    await app.close();
  });

  it('list / get / create 响应剔除已填充的 owner', async () => {
    const auth = `Bearer ${token}`;

    const list = await request(server)
      .get('/v1/knowledge')
      .set('Authorization', auth)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('SENTINEL');
    const listItem = (list.body as ApiBody<{ list: Record<string, unknown>[] }>)
      .data.list[0];
    expect(listItem).not.toHaveProperty('owner');
    expect(Object.keys(listItem).sort()).toEqual(
      [
        'id',
        'ownerId',
        'visibility',
        'name',
        'description',
        'createdAt',
        'updatedAt',
        'likeCount',
        'isLiked',
      ].sort(),
    );

    const detail = await request(server)
      .get(`/v1/knowledge/${kbId}`)
      .set('Authorization', auth)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('SENTINEL');
    expect(
      (detail.body as ApiBody<Record<string, unknown>>).data,
    ).not.toHaveProperty('owner');

    const created = await request(server)
      .post('/v1/knowledge')
      .set('Authorization', auth)
      .send({ name: 'x', description: 'd' })
      .expect(201);
    expect(JSON.stringify(created.body)).not.toContain('SENTINEL');
  });

  it('documents 列表 / 详情响应剔除已填充的 knowledgeBase 与 file', async () => {
    const auth = `Bearer ${token}`;

    const docs = await request(server)
      .get(`/v1/knowledge/${kbId}/documents`)
      .set('Authorization', auth)
      .expect(200);
    expect(JSON.stringify(docs.body)).not.toContain('SENTINEL');
    // 钉住列表的 envelope 键集：契约是页码分页的 {list,total,page,pageSize}，无 nextCursor。
    // （桩的类型已从 DocumentListResultDto 派生，这条断言钉的是**真实响应**，不是桩。）
    expect(
      Object.keys((docs.body as ApiBody<Record<string, unknown>>).data).sort(),
    ).toEqual(['list', 'page', 'pageSize', 'total'].sort());
    const docItem = (docs.body as ApiBody<{ list: Record<string, unknown>[] }>)
      .data.list[0];
    expect(docItem).not.toHaveProperty('knowledgeBase');
    expect(docItem).not.toHaveProperty('file');
    // 本组用例把 KnowledgeDocumentService 换成了桩，它直接返回**实体**（不经 `toDocumentListItem` 映射），
    // 所以这里的字段集是实体的那几列——契约形状（文件元数据 / 不含 content）由上面第一组用例
    // 在真实服务上验证。本用例要钉的是另一件事：无论哪条路径出网，内部关系对象都被 @Exclude 剔除。
    expect(docItem).not.toHaveProperty('content');
    expect(Object.keys(docItem).sort()).toEqual(
      [
        'id',
        'knowledgeBaseId',
        'fileId',
        'title',
        'createdAt',
        'updatedAt',
      ].sort(),
    );

    const detail = await request(server)
      .get(`/v1/knowledge/${kbId}/documents/${docId}`)
      .set('Authorization', auth)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('SENTINEL');
    const detailItem = (detail.body as ApiBody<Record<string, unknown>>).data;
    expect(detailItem).not.toHaveProperty('knowledgeBase');
    expect(detailItem).not.toHaveProperty('file');
    // 详情仍返回解析全文
    expect(detailItem.content).toBe('body');
  });
});
