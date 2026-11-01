// 与 data-source 同源：连接参数（HOST/PORT/USER/PASSWORD）都从 .env + process.env 取，
// 否则脚本可能按默认值 127.0.0.1:5432 去 DROP/CREATE，而用例连的是另一台库。
import 'dotenv/config';
import { Client } from 'pg';
import { E2E_DB_NAME } from './e2e-db-config.js';

/**
 * e2e 前置：重建测试库 → 跑迁移 → **验一次真实往返**（撤销到最后 → 重跑）。
 * 由 `test:e2e` 脚本在本进程里先执行。
 *
 * 为什么需要它：`process.env.DB_NAME = 'lucy_test'` 写在各 spec 文件顶部是无效的——
 * ESM 会把 `import { AppModule }` 提升到模块体之前求值，`ConfigModule.forRoot`
 * 在那一刻就读完 `.env` + `process.env` 并在校验后快照，之后再改 process.env 已经
 * 不影响 `config.get('DB_NAME')`。结果是 e2e 一直打在**开发库**上（用例里的原生 SQL
 * DELETE 也打在开发库）。库名现由 `vitest.e2e.config.ts` 的 `test.env` 统一指定，
 * 本文件负责把那个库准备好。
 *
 * 每次运行前重建（而不是「存在就复用」）：迁移历史一旦变化（例如压缩迁移），
 * 旧测试库的 `migrations` 记录与当前迁移集不一致，`runMigrations()` 会因对象已存在而失败。
 * 测试库本来就是一次性的，重建最省心。
 *
 * 放在 `test:e2e` 脚本里而不是 vitest 的 `globalSetup`：后者由 Node 原生 ESM 加载器直接
 * 加载，`*.ts` 里的类型语法会以 `SyntaxError: Invalid or unexpected token` 收场。
 */

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 5432);
const USER = process.env.DB_USER ?? 'postgres';
const PASSWORD = process.env.DB_PASSWORD ?? 'postgres';

const admin = new Client({
  host: HOST,
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: 'postgres',
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${E2E_DB_NAME}"`);
await admin.end();

// 必须在 import data-source 之前钉住库名：它在模块求值时读取 process.env.DB_NAME，
// 而顶部的 `dotenv/config` 会把 .env 里的开发库名灌进来
process.env.DB_NAME = E2E_DB_NAME;
const { default: dataSource } = await import('../src/db/data-source.js');
await dataSource.initialize();
try {
  // 一致性断言：脚本 DROP/CREATE 的位置必须就是被测应用实际连的位置
  const options = dataSource.options as {
    host?: string;
    port?: number;
    username?: string;
    database?: string;
  };
  if (
    options.database !== E2E_DB_NAME ||
    options.host !== HOST ||
    options.port !== PORT ||
    options.username !== USER
  ) {
    throw new Error(
      `e2e 连接参数不一致：脚本 ${HOST}:${PORT} user=${USER} db=${E2E_DB_NAME}，` +
        `DataSource ${options.host}:${options.port} user=${options.username} db=${options.database}`,
    );
  }

  await dataSource.runMigrations();

  // 真实往返：runMigrations() 只证明 up() 能跑，「可回滚」是另一条断言——
  // migration.spec 用的是假 QueryRunner，验不了 TypeORM 在 none 模式下是否真的执行了 down()。
  // 测试库是一次性的，撤销最后一条再重跑，把该前提钉成事实。
  await dataSource.undoLastMigration();
  await dataSource.runMigrations();

  // 邮箱归一迁移的真实数据验证：prepare 每次重建空库后立即 runMigrations，
  // 归一 UPDATE 与重复账号检测都只对空表执行——字符集/转义写错不会有任何用例变红。
  // 这里撤到归一迁移之前，灌入存量行再重跑迁移并断言结果。
  const appliedMigrationNames = async (): Promise<string[]> =>
    (
      await dataSource.query<{ name: string }[]>(
        `SELECT "name" FROM "migrations" ORDER BY "id"`,
      )
    ).map((row) => row.name);
  const emailMigrationPrefixes = [
    'NormalizeUserEmailCase',
    'AddUserEmailNormalizedCheck',
  ];
  // 按名字定位而不是「撤最后两条」：后续新增迁移会让固定次数撤销撤错目标，
  // 留下「归一仍生效、CHECK 已被撤」的状态——灌入的存量行不会归一，随后
  // ADD CONSTRAINT 校验存量行时会让整轮后端 e2e 失败。
  const undoEmailMigrations = async (): Promise<void> => {
    const applied = await appliedMigrationNames();
    for (const prefix of emailMigrationPrefixes) {
      if (!applied.some((name) => name.startsWith(prefix))) {
        throw new Error(`迁移链里找不到 ${prefix}，无法验证邮箱归一`);
      }
    }
    for (let guard = 0; guard < 100; guard += 1) {
      const names = await appliedMigrationNames();
      const stillApplied = names.some((name) =>
        emailMigrationPrefixes.some((prefix) => name.startsWith(prefix)),
      );
      if (!stillApplied) return;
      await dataSource.undoLastMigration();
    }
    throw new Error('撤销邮箱归一迁移超过 100 次，迁移链异常');
  };
  const seededEmails = () =>
    dataSource.query<{ username: string; email: string }[]>(
      `SELECT "username", "email" FROM "users"
        WHERE "username" LIKE 'e2e\\_mig\\_%'
        ORDER BY "username"`,
    );
  const clearSeeded = () =>
    dataSource.query(
      `DELETE FROM "users" WHERE "username" LIKE 'e2e\\_mig\\_%'`,
    );

  await undoEmailMigrations();
  await dataSource.query(
    `INSERT INTO "users" ("username", "email", "password_hash") VALUES
       ('e2e_mig_case', 'Alice@Example.COM', 'x'),
       ('e2e_mig_space', ' bob@example.com ', 'x'),
       ('e2e_mig_nbsp', E'\\u00A0carol@example.com\\u3000', 'x')`,
  );
  await dataSource.runMigrations();
  const normalized = await seededEmails();
  const expected = [
    { username: 'e2e_mig_case', email: 'alice@example.com' },
    { username: 'e2e_mig_nbsp', email: 'carol@example.com' },
    { username: 'e2e_mig_space', email: 'bob@example.com' },
  ];
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`邮箱归一结果不符：${JSON.stringify(normalized)}`);
  }
  await clearSeeded();

  // 冲突检测：两行归一后相同 → 迁移必须中止，且事务回滚不留下半归一状态
  await undoEmailMigrations();
  await dataSource.query(
    `INSERT INTO "users" ("username", "email", "password_hash") VALUES
       ('e2e_mig_dup1', 'Dup@Example.com', 'x'),
       ('e2e_mig_dup2', 'dup@example.com ', 'x')`,
  );
  let conflictError: unknown;
  try {
    await dataSource.runMigrations();
  } catch (error) {
    conflictError = error;
  }
  await clearSeeded();
  if (!String(conflictError).includes('归一后相同的重复账号')) {
    throw new Error(`冲突检测未按预期中止迁移：${String(conflictError)}`);
  }
  // 清掉冲突行后重跑，把测试库恢复成「全部迁移已应用」
  await dataSource.runMigrations();

  const rows = await dataSource.query<{ table_name: string | null }[]>(
    `SELECT to_regclass('public.users') AS table_name`,
  );
  if (!rows[0]?.table_name) {
    throw new Error('e2e 往返验证失败：撤销并重跑迁移后 users 表不存在');
  }
  console.log(
    `[e2e] 测试库已就绪（含 migrate → revert → migrate 往返与邮箱归一数据验证）：${E2E_DB_NAME}`,
  );
} finally {
  await dataSource.destroy();
}
