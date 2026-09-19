/**
 * e2e 前置：重建测试库并跑迁移（由 `test:e2e` 脚本在本进程里先执行）。
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
import { Client } from 'pg';

/** e2e 专用库名：与 vitest.e2e.config.ts 的 test.env 保持一致 */
const TEST_DB = process.env.DB_NAME ?? 'lucy_test';

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 5432);
const USER = process.env.DB_USER ?? 'postgres';
const PASSWORD = process.env.DB_PASSWORD ?? 'postgres';

// 安全阀：本文件会 DROP DATABASE，绝不允许指向非测试库
if (!TEST_DB.endsWith('_test')) {
  throw new Error(
    `e2e 只允许在 *_test 库上运行（当前 DB_NAME=${TEST_DB}），请检查环境变量`,
  );
}

const admin = new Client({
  host: HOST,
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: 'postgres',
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${TEST_DB}"`);
await admin.end();

// 必须在 import data-source 之前钉住库名：它在模块求值时读取 process.env.DB_NAME，
// 而顶层的 `dotenv/config` 会把 .env 里的 lucy 灌进来
process.env.DB_NAME = TEST_DB;
const { default: dataSource } = await import('../src/db/data-source.js');
await dataSource.initialize();
try {
  await dataSource.runMigrations();
  console.log(`[e2e] 测试库已就绪：${TEST_DB}`);
} finally {
  await dataSource.destroy();
}
