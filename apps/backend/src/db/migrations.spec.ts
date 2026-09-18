import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** 匹配类字段声明 `transaction = true;` / `public transaction = false;` */
const TRANSACTION_DECLARATION =
  /^\s*(?:public\s+|readonly\s+|private\s+)*transaction\s*=\s*(?:true|false)\s*;/m;

describe('迁移事务约定', () => {
  it('扫描到迁移文件（防止文件名规则失效后本检查空跑）', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it('每个迁移都显式声明 transaction（none 模式下未声明 = 非原子）', () => {
    const missing = migrationFiles.filter(
      (file) =>
        !TRANSACTION_DECLARATION.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        ),
    );

    expect(
      missing,
      `以下迁移未声明 transaction，在 migrationsTransactionMode: 'none' 下会被静默按非原子执行：\n` +
        `${missing.join('\n')}\n` +
        `需要原子性请加 \`transaction = true;\`；必须裸跑（CONCURRENTLY / 分批回填）请加 \`transaction = false;\` 并说明理由。`,
    ).toEqual([]);
  });
});
