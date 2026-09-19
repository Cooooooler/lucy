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
  // 测试库是一次性的，这里直接撤销到最后（含初始化迁移）再重跑，把该前提钉成每次 e2e 都跑的事实。
  for (let i = 0; i < 2; i++) {
    await dataSource.undoLastMigration();
  }
  await dataSource.runMigrations();

  const rows = await dataSource.query<{ table_name: string | null }[]>(
    `SELECT to_regclass('public.users') AS table_name`,
  );
  if (!rows[0]?.table_name) {
    throw new Error('e2e 往返验证失败：撤销并重跑迁移后 users 表不存在');
  }
  console.log(
    `[e2e] 测试库已就绪（含 migrate → revert ×2 → migrate 往返）：${E2E_DB_NAME}`,
  );
} finally {
  await dataSource.destroy();
}
