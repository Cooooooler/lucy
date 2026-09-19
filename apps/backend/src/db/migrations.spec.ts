import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { MigrationInterface } from 'typeorm';
import { describe, expect, it } from 'vitest';

/**
 * 全局 `migrationsTransactionMode: 'none'`（data-source.ts）让每个迁移自行决定事务：
 * TypeORM 会把未声明的 `transaction` 落到「不进事务」，于是多语句迁移中途失败会留下
 * 部分变更且无法重跑——原子性从默认变成了需要显式索要的东西。
 *
 * 本测试把这条约定变成可执行检查：每个迁移都必须显式声明 `transaction`。
 * 批量回填、`CREATE INDEX CONCURRENTLY` 这类**必须**裸跑的迁移写 `transaction = false`
 * 并给出理由；其余迁移写 `transaction = true` 拿回原子性。
 *
 * 断言对象是**加载后的迁移实例**而不是源码文本：正则扫源码时，块注释里出现一行
 * `transaction = true;` 就能让检查通过，而实例属性才是 TypeORM 真正读取的东西。
 *
 * 注意本文件必须放在 migrations 目录**之外**：DataSource 的 migrations glob 是
 * `src/db/migrations/**\/*.ts`，`db:migrate` 用 tsx 直接跑源码，把 spec 放进去会被
 * 当成迁移文件加载并报错。
 */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((file) =>
  /^\d+.*\.ts$/.test(file),
);

/**
 * 允许裸跑（`transaction = false`）的迁移**白名单**：只放行「必须在事务外执行」的迁移
 * ——`CREATE INDEX CONCURRENTLY`、分批回填。往里加名字就是一次显式决定，
 * 借此挡住「照抄一句 transaction = false」或把语义写反却仍然绿灯。
 */
const BARE_RUN_MIGRATIONS = new Set<string>([]);

/** 迁移文件名是否在白名单里（按类名匹配；改名即失效 → 必须重新确认） */
function isBareRunAllowed(file: string): boolean {
  return [...BARE_RUN_MIGRATIONS].some((name) => file.includes(name));
}

/** 加载迁移模块并取出生明的迁移类实例 */
async function loadMigrationInstances(): Promise<
  { file: string; instance: MigrationInterface }[]
> {
  return Promise.all(
    migrationFiles.map(async (file) => {
      const url = pathToFileURL(join(MIGRATIONS_DIR, file)).href;
      const module = (await import(url)) as Record<string, unknown>;
      const MigrationClass = Object.values(module).find(
        (value): value is new () => MigrationInterface =>
          typeof value === 'function' &&
          value.prototype !== undefined &&
          'up' in value.prototype &&
          'down' in value.prototype,
      );
      if (!MigrationClass) {
        throw new Error(`${file} 没有导出迁移类`);
      }
      return { file, instance: new MigrationClass() };
    }),
  );
}

describe('迁移事务约定', () => {
  it('扫描到迁移文件（防止文件名规则失效后本检查空跑）', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it('每个迁移都显式声明 transaction（none 模式下未声明 = 非原子）', async () => {
    const migrations = await loadMigrationInstances();
    const missing = migrations
      .filter(({ instance }) => instance.transaction === undefined)
      .map(({ file }) => file);

    expect(
      missing,
      `以下迁移未声明 transaction，在 migrationsTransactionMode: 'none' 下会被静默按非原子执行：\n` +
        `${missing.join('\n')}\n` +
        `需要原子性请加 \`transaction = true;\`；必须裸跑（CONCURRENTLY / 分批回填）请加 \`transaction = false;\` 并说明理由。`,
    ).toEqual([]);
  });

  it('除裸跑白名单外，迁移必须显式声明 transaction = true', async () => {
    const migrations = await loadMigrationInstances();
    const notAtomic = migrations
      .filter(
        ({ file, instance }) =>
          instance.transaction !== true && !isBareRunAllowed(file),
      )
      .map(({ file }) => file);

    expect(
      notAtomic,
      `以下迁移声明了 \`transaction = false\`（或写法有误）却不在裸跑白名单里：\n` +
        `${notAtomic.join('\n')}\n` +
        `真的必须裸跑（CREATE INDEX CONCURRENTLY / 分批回填）请把类名加进 BARE_RUN_MIGRATIONS 并写明理由；` +
        `否则请改回 \`transaction = true\`——none 模式下一次中途失败会留下无法重跑的半成品。`,
    ).toEqual([]);
  });
});
