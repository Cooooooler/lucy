/**
 * 知识库仿真数据种子脚本（一次性数据准备，不属于产品代码）。
 *
 * 用法（在 apps/backend 目录下执行，不通过 package.json 注册）：
 *   pnpm --filter @lucy/backend exec tsx scripts/seed-knowledge.ts
 *
 * 行为：
 *   1. 用独立 DataSource 读 apps/backend/.env 的 DB_*（顶部 dotenv/config 内联读取）；
 *   2. 前置校验：能连库、目标 owner 用户名在 users 表中都存在，否则报错退出；
 *   3. 同一事务内「全量清空」knowledge_likes → knowledge_documents → knowledge_bases，
 *      再按 FK 顺序重新插入仿真数据（幂等：重复执行结果稳定）；
 *   4. 伪随机用内置 mulberry32 + 固定种子，名称/描述/可见性/时间布局/并列结构可复现；
 *   5. 结束时输出 JSON summary。
 *
 * 设计要点与边界见 .superpowers/sdd/seed-knowledge-report.md。
 */
import 'dotenv/config';
import { DataSource, EntityManager } from 'typeorm';

/** 固定种子：同一脚本重复执行产出稳定（uuid 亦由该序列派生） */
const SEED = 20260913;
/** 单条多行 INSERT 的分块行数：bases 7 列 → 3500 参数，likes 4 列 → 2000 参数，均远低于 65535 */
const INSERT_CHUNK = 500;
/** created_at 跨度：过去约 10 个月（按 304 天近似） */
const CREATED_SPAN_MS = 304 * 24 * 60 * 60 * 1000;
/** 与同一 owner 的其它行共享完全相同 created_at 的行占比（模拟同事务批量插入） */
const TIE_RATIO = 0.12;
/** 创建后被更新过的行占比（updated_at 明显晚于 created_at） */
const UPDATED_RATIO = 0.3;
/** 描述为 NULL 的行占比（真实数据里就有没写描述的） */
const NULL_DESC_RATIO = 0.15;
/** public 占比，其余 private */
const PUBLIC_RATIO = 0.45;
/** 并列组内每组的成员数范围 [2, 5] */
const TIE_GROUP_MIN = 2;
const TIE_GROUP_MAX = 5;

/** owner 分配：lucy 占大头（保证默认视图分页足够深），其余 5 人各 30~40 条 */
const OWNER_PLAN: readonly { username: string; count: number }[] = [
  { username: 'lucy', count: 205 },
  { username: 'lucytest_bt', count: 40 },
  { username: 'e2e_admin_56779017', count: 39 },
  { username: 'e2e_root_56779017', count: 38 },
  { username: 'e2e_target_56779017', count: 37 },
  { username: 'smoke_162312', count: 36 },
];

/* ------------------------------------------------------------------ 词池 */

const YEARS = ['2026', '2025'] as const;
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
const DOMAINS = [
  '产品',
  '前端',
  '后端',
  '数据',
  '算法',
  '运营',
  '市场',
  '安全',
  '测试',
  '设计',
  '基础架构',
  '客户成功',
] as const;
const TECHS = [
  'PostgreSQL',
  'Kubernetes',
  'Redis',
  'TypeScript',
  'Nginx',
  'Docker',
  'ClickHouse',
  'Flink',
  'Kafka',
  'NestJS',
  'React',
  'gRPC',
  'Prometheus',
] as const;
const TOPICS = [
  '增长',
  '留存',
  '转化',
  '灰度发布',
  '性能优化',
  '成本治理',
  '稳定性',
  '可观测性',
  '权限体系',
  '计费',
  '国际化',
  '埋点',
  '内容审核',
  '全文搜索',
  '推荐',
  '实时计算',
  '数据治理',
  '监控告警',
  '故障演练',
  '全链路压测',
  '发布流程',
  '代码评审',
  'CI/CD',
  '容器化',
  '多租户',
  '单点登录',
  '限流熔断',
  '缓存',
  '分库分表',
  '消息队列',
] as const;
const TYPES = [
  '规范',
  '手册',
  '指南',
  '方案',
  '复盘',
  '清单',
  '白皮书',
  'FAQ',
  'SOP',
  '模板',
  '最佳实践',
  '踩坑记录',
] as const;
const PREFIXES = ['内部', '对外', '新人', 'v2', 'v3', ''] as const;

/* ------------------------------------------------- 确定性伪随机（mulberry32） */

/** 标准 mulberry32：同一 seed → 同一序列 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Fisher-Yates，用同一个 rng 保证可复现 */
function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 由 rng 派生一个合法 UUIDv4：让 id 也随种子确定 —— 并列组内 `id DESC` 决胜顺序
 * 因此每次跑都一致，便于复现分页结果。
 */
function uuidFromRng(rng: Rng): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rng() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ------------------------------------------------------------------ 内容生成 */

interface NameCtx {
  domain: string;
  tech: string;
  topic: string;
  type: string;
}

const joinParts = (parts: readonly string[]): string =>
  parts.filter((p) => p.length > 0).join(' ');

/** 组合出「2026 Q3 增长复盘」「PostgreSQL 运维手册」这类看起来真实的名字 */
function genName(rng: Rng, ctx: NameCtx): string {
  const year = pick(rng, YEARS);
  const quarter = pick(rng, QUARTERS);
  const prefix = pick(rng, PREFIXES);
  switch (Math.floor(rng() * 8)) {
    case 0:
      return joinParts([year, quarter, ctx.topic + ctx.type]);
    case 1:
      return joinParts([ctx.tech, ctx.topic + ctx.type]);
    case 2:
      return joinParts([ctx.domain + ctx.type]);
    case 3:
      return joinParts([prefix, ctx.domain + ctx.topic + ctx.type]);
    case 4:
      return `${ctx.topic}${ctx.type}（${year}）`;
    case 5:
      return joinParts([`${ctx.domain}方向`, ctx.topic + ctx.type]);
    case 6:
      return joinParts([ctx.tech, ctx.type]);
    default:
      return `${ctx.type}：${ctx.domain}${ctx.topic}`;
  }
}

const DESC_BODIES: readonly ((ctx: NameCtx) => string)[] = [
  (c) =>
    `收录了团队在${c.domain}方向的${c.type}与案例，含背景、决策记录与常见问题。`,
  (c) =>
    `本文档整理了${c.topic}相关的${c.type}，覆盖流程、注意事项与落地过程中的踩坑总结。`,
  (c) =>
    `围绕 ${c.tech} 的${c.type}，从方案选型到线上验证逐条记录，适合新同学快速上手。`,
  (c) =>
    `${c.domain}团队沉淀的${c.type}，包含术语表、检查项与参考链接，持续更新中。`,
  (c) =>
    `面向${c.topic}场景的${c.type}，列举了常见误用与规避方式，附最小可复现示例。`,
  (c) =>
    `由${c.domain}方向负责人维护的${c.type}，明确了职责边界、输入输出与验收标准。`,
];

const DESC_TAILS = [
  '',
  '最近一次评审补充了回滚步骤与灰度策略。',
  '文中引用了过往的故障复盘，并标注了仍待验证的假设。',
  '目前版本已同步到团队 Wiki，历史讨论见文末评论区。',
  '相关脚本与配置样例放在附录，可直接复制使用。',
  '适用范围与前置条件写在开头，请先确认环境是否匹配。',
] as const;

/** 模板化但自然的描述；约 15% 返回 null，长度差异明显（拼 1~2 句正文 + 可选尾句） */
function genDescription(rng: Rng, ctx: NameCtx): string | null {
  if (rng() < NULL_DESC_RATIO) return null;
  const first = Math.floor(rng() * DESC_BODIES.length);
  const sentences = [DESC_BODIES[first](ctx)];
  // 第二句刻意选不同模板，避免出现「同一句重复两遍」的机器感
  if (rng() < 0.25) {
    const second =
      (first + 1 + Math.floor(rng() * (DESC_BODIES.length - 1))) %
      DESC_BODIES.length;
    sentences.push(DESC_BODIES[second](ctx));
  }
  let desc = sentences.join('') + pick(rng, DESC_TAILS);
  if (desc.length > 180) desc = desc.slice(0, 180);
  return desc;
}

/* ------------------------------------------------------------------ 行结构 */

interface SeedRow {
  id: string;
  ownerIdx: number;
  ownerId: string;
  name: string;
  description: string | null;
  visibility: 'private' | 'public';
  createdMs: number;
  updatedMs: number;
}

interface SeedLike {
  id: string;
  knowledgeBaseId: string;
  userId: string;
  createdMs: number;
}

/** 生成基础行：每行独立的 created 时间均匀落在过去约 10 个月内（尚未处理并列） */
function buildRows(
  rng: Rng,
  owners: readonly { id: string }[],
  nowMs: number,
): SeedRow[] {
  const rows: SeedRow[] = [];
  const minCreatedMs = nowMs - CREATED_SPAN_MS;
  owners.forEach((owner, ownerIdx) => {
    const { count } = OWNER_PLAN[ownerIdx];
    for (let i = 0; i < count; i++) {
      // 名称与描述共用同一组领域/技术/主题/类型词，读起来自洽
      const ctx: NameCtx = {
        domain: pick(rng, DOMAINS),
        tech: pick(rng, TECHS),
        topic: pick(rng, TOPICS),
        type: pick(rng, TYPES),
      };
      const createdMs =
        minCreatedMs + Math.floor(rng() * (CREATED_SPAN_MS + 1));
      rows.push({
        id: uuidFromRng(rng),
        ownerIdx,
        ownerId: owner.id,
        name: genName(rng, ctx),
        description: genDescription(rng, ctx),
        // 先占位，buildRows 结束后统一按比例分配
        visibility: 'private',
        createdMs,
        // 先占位，并列处理完再统一算 updated
        updatedMs: createdMs,
      });
    }
  });
  return rows;
}

/**
 * 可见性按比例精确分配：随机打散后前 round(N * PUBLIC_RATIO) 行为 public，其余 private，
 * 使分布稳定落在 ~45%/55%，不受单次随机波动影响。
 */
function applyVisibility(rng: Rng, rows: SeedRow[]): void {
  const target = Math.round(rows.length * PUBLIC_RATIO);
  const order = shuffle(
    rng,
    rows.map((_, i) => i),
  );
  order.forEach((rowIdx, rank) => {
    rows[rowIdx].visibility = rank < target ? 'public' : 'private';
  });
}

/**
 * 制造并列：按 owner 分组，每组 2~5 行共享组内「锚点」行的 created_at。
 * 覆盖约 TIE_RATIO 的行，返回并列组（每组为行下标数组）。
 */
function applyTies(rng: Rng, rows: SeedRow[]): number[][] {
  const byOwner = new Map<number, number[]>();
  rows.forEach((row, i) => {
    const list = byOwner.get(row.ownerIdx);
    if (list) list.push(i);
    else byOwner.set(row.ownerIdx, [i]);
  });

  const groups: number[][] = [];
  for (const idxs of byOwner.values()) {
    const order = shuffle(rng, idxs);
    const target = Math.round(idxs.length * TIE_RATIO);
    let covered = 0;
    let p = 0;
    while (covered < target && p + 1 < order.length) {
      const size = Math.min(
        TIE_GROUP_MIN + Math.floor(rng() * (TIE_GROUP_MAX - TIE_GROUP_MIN + 1)),
        order.length - p,
      );
      if (size < TIE_GROUP_MIN) break;
      const group = order.slice(p, p + size);
      groups.push(group);
      const anchorMs = rows[group[0]].createdMs;
      for (const i of group) rows[i].createdMs = anchorMs;
      covered += size;
      p += size;
    }
  }
  return groups;
}

/** updated_at ≥ created_at：约 UPDATED_RATIO 的行明显晚于创建时间，其余等于创建时间 */
function applyUpdated(rng: Rng, rows: SeedRow[], nowMs: number): void {
  const oneDay = 24 * 60 * 60 * 1000;
  for (const row of rows) {
    if (rng() < UPDATED_RATIO) {
      const span = nowMs - row.createdMs - oneDay;
      if (span > 0) {
        row.updatedMs = row.createdMs + oneDay + Math.floor(rng() * span);
        continue;
      }
    }
    row.updatedMs = row.createdMs;
  }
}

/** 每行点赞数分布（0~9），权重和 1000，期望 ≈ 1.4 次/行 */
const LIKE_WEIGHTS = [450, 230, 120, 70, 45, 30, 20, 15, 12, 8] as const;

function weightedPickLikeCount(rng: Rng): number {
  const total = LIKE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let k = 0; k < LIKE_WEIGHTS.length; k++) {
    r -= LIKE_WEIGHTS[k];
    if (r < 0) return k;
  }
  return 0;
}

function buildLikes(
  rng: Rng,
  rows: readonly SeedRow[],
  likerIds: readonly string[],
  nowMs: number,
): SeedLike[] {
  const likes: SeedLike[] = [];
  for (const row of rows) {
    const k = Math.min(weightedPickLikeCount(rng), likerIds.length);
    if (k === 0) continue;
    // 同一知识库内取互不相同的点赞人，天然满足 (kb, user) 唯一
    for (const userId of shuffle(rng, likerIds).slice(0, k)) {
      const span = nowMs - row.createdMs;
      const createdMs =
        row.createdMs + (span > 0 ? Math.floor(rng() * span) : 0);
      likes.push({
        id: uuidFromRng(rng),
        knowledgeBaseId: row.id,
        userId,
        createdMs,
      });
    }
  }
  return likes;
}

/* ------------------------------------------------------------------ 主流程 */

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lucy',
});

interface Summary {
  reset: { likes: number; documents: number; bases: number };
  inserted: { bases: number; likes: number };
  owners: number;
  visibility: { private: number; public: number };
  ties: number;
  createdRange: [string, string];
}

/** 单条多行 INSERT：按行分块，避免超过 Postgres 参数上限 */
async function insertBases(
  manager: EntityManager,
  rows: readonly SeedRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const params: unknown[] = [];
    const values = chunk.map((row, idx) => {
      const b = idx * 7;
      params.push(
        row.id,
        row.ownerId,
        row.name,
        row.description,
        row.visibility,
        new Date(row.createdMs),
        new Date(row.updatedMs),
      );
      return `($${b + 1}::uuid, $${b + 2}::uuid, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await manager.query(
      `INSERT INTO knowledge_bases (id, owner_id, name, description, visibility, created_at, updated_at) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

async function insertLikes(
  manager: EntityManager,
  likes: readonly SeedLike[],
): Promise<void> {
  for (let i = 0; i < likes.length; i += INSERT_CHUNK) {
    const chunk = likes.slice(i, i + INSERT_CHUNK);
    const params: unknown[] = [];
    const values = chunk.map((like, idx) => {
      const b = idx * 4;
      params.push(
        like.id,
        like.knowledgeBaseId,
        like.userId,
        new Date(like.createdMs),
      );
      return `($${b + 1}::uuid, $${b + 2}::uuid, $${b + 3}::uuid, $${b + 4})`;
    });
    await manager.query(
      `INSERT INTO knowledge_likes (id, knowledge_base_id, user_id, created_at) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

async function main(): Promise<void> {
  // 前置校验 1：能连上库
  await ds.initialize();

  // 前置校验 2：目标 owner 用户名必须都存在
  const ownerRows = await ds.query<{ id: string; username: string }[]>(
    `SELECT id, username FROM users WHERE username = ANY($1::text[])`,
    [OWNER_PLAN.map((o) => o.username)],
  );
  const found = new Map(ownerRows.map((r) => [r.username, r.id]));
  const missing = OWNER_PLAN.filter((o) => !found.has(o.username)).map(
    (o) => o.username,
  );
  if (missing.length > 0) {
    throw new Error(`users 表中缺少 owner 用户：${missing.join(', ')}`);
  }
  const owners = OWNER_PLAN.map((o) => ({ id: found.get(o.username)! }));

  // 点赞人池：复用库里已存在用户（数量需 ≥ 9，likeCount 才能落到 0~9）
  const likerRows = await ds.query<{ id: string }[]>(`SELECT id FROM users`);
  const likerIds = likerRows.map((r) => r.id);
  if (likerIds.length < 9) {
    throw new Error(
      `可点赞用户不足（${likerIds.length} 个），无法形成 0~9 的 likeCount 分布`,
    );
  }

  const nowMs = Date.now();
  const rng = mulberry32(SEED);

  const rows = buildRows(rng, owners, nowMs);
  applyVisibility(rng, rows);
  const tieGroups = applyTies(rng, rows);
  applyUpdated(rng, rows, nowMs);
  const likes = buildLikes(rng, rows, likerIds, nowMs);

  const visibility = {
    private: rows.filter((r) => r.visibility === 'private').length,
    public: rows.filter((r) => r.visibility === 'public').length,
  };
  const createdMsList = rows.map((r) => r.createdMs);
  const createdRange: [string, string] = [
    new Date(Math.min(...createdMsList)).toISOString(),
    new Date(Math.max(...createdMsList)).toISOString(),
  ];

  const summary = await ds.transaction(async (manager) => {
    // 全量清空（FK 顺序），并记录清理前行数
    const [{ n: likesReset }] = await manager.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM knowledge_likes`,
    );
    const [{ n: docsReset }] = await manager.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM knowledge_documents`,
    );
    const [{ n: basesReset }] = await manager.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM knowledge_bases`,
    );
    await manager.query(`DELETE FROM knowledge_likes`);
    await manager.query(`DELETE FROM knowledge_documents`);
    await manager.query(`DELETE FROM knowledge_bases`);

    await insertBases(manager, rows);
    await insertLikes(manager, likes);

    const result: Summary = {
      reset: { likes: likesReset, documents: docsReset, bases: basesReset },
      inserted: { bases: rows.length, likes: likes.length },
      owners: owners.length,
      visibility,
      ties: tieGroups.length,
      createdRange,
    };
    return result;
  });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err: unknown) => {
    console.error(
      `[seed-knowledge] 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ds.isInitialized) await ds.destroy();
  });
