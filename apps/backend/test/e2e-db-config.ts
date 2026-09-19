/**
 * e2e 测试库配置的**唯一定义处**。
 *
 * 两处必须一致，否则会出现「准备了 A 库、用例连 B 库」：
 * - `vitest.e2e.config.ts` 用它设置 `test.env.DB_NAME`（决定用例连哪个库）；
 * - `test/prepare-e2e-db.ts` 用它重建并迁移（决定 DROP/CREATE 哪个库）。
 *
 * 安全阀也放这里：用例里有**裸 DELETE**（deleteTestUserData 直接删知识库/文档/文件/用户），
 * 因此任何入口——`pnpm test:e2e` 也好、直接 `vitest run --config vitest.e2e.config.ts` 也好——
 * 都必须先撞上这条断言，而不是依赖调用方记得先跑 prepare。
 *
 * 刻意用独立的 `E2E_DB_NAME`（而不是复用 `DB_NAME`）：`.env` 里的 `DB_NAME` 是**开发库**，
 * prepare 脚本会加载 `.env`（与 data-source 同源），复用那个键会让默认值直接落到开发库上。
 */
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'lucy_test';

if (!E2E_DB_NAME.endsWith('_test')) {
  throw new Error(
    `e2e 只允许在 *_test 库上运行（当前 E2E_DB_NAME=${E2E_DB_NAME}）：用例会对该库执行裸 DELETE，绝不允许指向开发/生产库`,
  );
}
