/**
 * e2e 测试库连接参数的**唯一定义处**。
 *
 * 三处必须一致，否则会出现「准备了 A 库、用例连 B 库」：
 * - `vitest.e2e.config.ts` 用它设置 `test.env.DB_*`（决定用例连哪个库）；
 * - `test/support/prepare-e2e-db.ts` 用它连管理库并重建、迁移（决定 DROP/CREATE 哪个库）；
 * - `test/support/require-e2e-db.ts` 用它做前置体检（决定拦不拦「没准备过库」的直接运行）。
 *
 * 刻意**只读 `E2E_DB_*`**（而不是复用 `DB_*`）：`apps/backend/.env` 里的 `DB_HOST`/`DB_NAME`
 * 指向开发库，prepare 脚本会 DROP/CREATE，一旦读那个键就等于把开发库交给脚本处置。
 * 默认值对齐 CI（127.0.0.1:5432）；本地 Docker 把 5432 映射到别的端口时用
 * `E2E_DB_PORT=55432 pnpm --filter @lucy/backend test:e2e` 覆盖，不要去改这里的默认值。
 */

/** 允许的「本机」写法：其余主机要靠 E2E_ALLOW_REMOTE=1 显式放行 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const E2E_DB_HOST = process.env.E2E_DB_HOST ?? '127.0.0.1';
export const E2E_DB_PORT = Number(process.env.E2E_DB_PORT ?? 5432);
export const E2E_DB_USER = process.env.E2E_DB_USER ?? 'postgres';
export const E2E_DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'postgres';
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'lucy_test';

if (!Number.isInteger(E2E_DB_PORT) || E2E_DB_PORT <= 0) {
  throw new Error(
    `E2E_DB_PORT 必须是正整数（当前 ${String(process.env.E2E_DB_PORT)}）`,
  );
}

/**
 * 主机安全阀：prepare 脚本会 `DROP DATABASE ... WITH (FORCE)`，用例里还有裸 DELETE，
 * 所以除了本机地址一律拒绝——`.env`、shell 环境、IDE 运行配置里残留的
 * `E2E_DB_HOST` 都不能悄悄把这两个破坏性操作指到远程库上。
 *
 * 放在本模块（而不是 prepare / vitest 配置各自再写一遍）：模块只在被 import 时求值一次，
 * 两个入口都会经过这里，漏改一处也没机会绕过去。
 */
if (process.env.E2E_ALLOW_REMOTE !== '1' && !LOCAL_HOSTS.has(E2E_DB_HOST)) {
  throw new Error(
    `e2e 只允许连本机数据库（当前 E2E_DB_HOST=${E2E_DB_HOST}）：` +
      'prepare 脚本会对该库执行 DROP DATABASE ... WITH (FORCE)，用例还会裸 DELETE。' +
      '确需连远程测试库时显式设置 E2E_ALLOW_REMOTE=1。',
  );
}

if (!E2E_DB_NAME.endsWith('_test')) {
  throw new Error(
    `e2e 只允许在 *_test 库上运行（当前 E2E_DB_NAME=${E2E_DB_NAME}）：用例会对该库执行裸 DELETE，绝不允许指向开发/生产库`,
  );
}
