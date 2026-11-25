import { Client } from 'pg';
import {
  E2E_DB_HOST,
  E2E_DB_NAME,
  E2E_DB_PASSWORD,
  E2E_DB_PORT,
  E2E_DB_USER,
} from './e2e-db-config.js';

/**
 * e2e 前置体检（`setupFiles`，在 spec 之前跑）。
 *
 * 为什么需要：`test:e2e` 会先跑 `test/prepare-e2e-db.ts` 重建库并迁移，但开发者（或 IDE
 * 运行配置）常常直接跑 `vitest --config vitest.e2e.config.ts`。那时如果库是旧的
 * （迁移没跟上）、干脆没建过、或者 PostgreSQL 没起来，后续 spec 会以「表不存在」
 * 「连接被拒」这类与代码无关的错误红掉，排查方向完全跑偏。这里提前一步把它变成
 * 一句能照做的报错。
 *
 * **只读**：只 `SELECT` / 连一台已有的库，绝不 CREATE/DROP/迁移——准备库是 prepare
 * 脚本的职责，两处都动 schema 会让「谁把库改成这样」变得不可追。
 */
const target = `${E2E_DB_NAME}@${E2E_DB_HOST}:${String(E2E_DB_PORT)}`;

const PREPARE_HINT =
  '请先运行 `pnpm --filter @lucy/backend test:e2e`（它会重建测试库并跑迁移；' +
  '本地 5432 被占用时用 `E2E_DB_PORT=<端口> pnpm --filter @lucy/backend test:e2e`），' +
  '再直接跑 vitest。';

const client = new Client({
  host: E2E_DB_HOST,
  port: E2E_DB_PORT,
  user: E2E_DB_USER,
  password: E2E_DB_PASSWORD,
  database: E2E_DB_NAME,
});

try {
  await client.connect();

  const tables = await client.query<{ users: string | null }>(
    `SELECT to_regclass('public.users') AS users`,
  );
  if (!tables.rows[0]?.users) {
    throw new Error(
      `e2e 测试库 ${target} 里没有 public.users 表：这是一个未初始化（或未迁移）的库。${PREPARE_HINT}`,
    );
  }

  // 表在但迁移历史为空的库（手工 dump / 恢复出来的）同样不可信：prepare 的
  // migrate → revert → migrate 往返与邮箱归一验证都是在迁移链上做的。
  const migrations = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "migrations"`,
  );
  if (Number(migrations.rows[0]?.count ?? 0) <= 0) {
    throw new Error(
      `e2e 测试库 ${target} 的 "migrations" 表没有记录：schema 来路不明，` +
        `无法确认与当前实体一致。${PREPARE_HINT}`,
    );
  }
} catch (error) {
  // 自己的提示原样抛出（保留准确原因）；连接/查询失败则补上「先跑 prepare」的指引，
  // 否则开发者只会看到一句 `database "xxx" does not exist` 或 ECONNREFUSED。
  if (error instanceof Error && error.message.startsWith('e2e 测试库')) {
    throw error;
  }
  throw new Error(
    `e2e 测试库 ${target} 体检失败：${error instanceof Error ? error.message : String(error)}。${PREPARE_HINT}`,
    { cause: error },
  );
} finally {
  // 体检完立刻断开，不在 spec 之间留连接
  try {
    await client.end();
  } catch {
    // 连接都没建起来时 end() 也会抛（pg 行为），以 catch 分支的报错为准
  }
}
