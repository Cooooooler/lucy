import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { InitSchema1789700000000 } from './migrations/1789700000000-InitSchema.js';
import { DropRedundantKnowledgeIndexes1789800000000 } from './migrations/1789800000000-DropRedundantKnowledgeIndexes.js';

/**
 * 初始化迁移的 up/down 是**有分支**的（存量库 baseline / 全新库建库），
 * 只有真库上跑两种库才能覆盖，而 e2e 每次 DROP DATABASE 重建、只会走全新库那条。
 * 这里用假的 QueryRunner 把两条分支都钉住：
 *
 * - up()：schema 已在（存量库）→ 只探测、不建表；schema 不在（全新库）→ 执行 DDL。
 * - down()：之前还有已执行的迁移（存量库）→ 不拆库；没有（全新库）→ 整库拆掉。
 *
 * 第二条尤其重要：up() 在存量库上是 no-op，若 down() 无条件 DROP，在那类库上执行一次
 * `db:revert` 会把整个库清空。
 */
function fakeQueryRunner(rows: unknown[]): {
  queryRunner: QueryRunner;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue(rows);
  return { queryRunner: { query } as unknown as QueryRunner, query };
}

/** 取出被执行的 SQL 语句（跳过探测语句的参数化调用） */
const sqlCalls = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map((call) => String(call[0]));

describe('InitSchema 迁移的新库/存量库分支', () => {
  const migration = new InitSchema1789700000000();

  it('全新库：探测不到 users 表 → 执行整段建库 DDL', async () => {
    const { queryRunner, query } = fakeQueryRunner([{ table_name: null }]);

    await migration.up(queryRunner);

    const sql = sqlCalls(query);
    expect(sql[0]).toContain('to_regclass');
    expect(sql.some((s) => s.includes('CREATE TABLE "users"'))).toBe(true);
  });

  it('存量库：探测到 users 表 → 只探测、不建表（schema 早已存在）', async () => {
    const { queryRunner, query } = fakeQueryRunner([{ table_name: 'users' }]);

    await migration.up(queryRunner);

    const sql = sqlCalls(query);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('to_regclass');
  });

  it('全新库 revert：没有更早的迁移记录 → 整库拆掉（create → revert → 重跑 往返可用）', async () => {
    const { queryRunner, query } = fakeQueryRunner([{ executed: 0 }]);

    await migration.down(queryRunner);

    expect(
      sqlCalls(query).some((s) => s.includes('DROP TABLE "knowledge_likes"')),
    ).toBe(true);
  });

  it('存量库 revert：存在更早的迁移记录 → 不动任何表（否则 db:revert 会清空全库）', async () => {
    const { queryRunner, query } = fakeQueryRunner([{ executed: 16 }]);

    await migration.down(queryRunner);

    const sql = sqlCalls(query);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('FROM "migrations"');
    expect(sql.some((s) => s.includes('DROP'))).toBe(false);
  });
});

describe('冗余索引清理迁移', () => {
  const migration = new DropRedundantKnowledgeIndexes1789800000000();

  it('up：两条冗余索引都 IF EXISTS 删除（新库空转、存量库真正删）', async () => {
    const { queryRunner, query } = fakeQueryRunner([]);

    await migration.up(queryRunner);

    const sql = sqlCalls(query).join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_knowledge_documents_kb"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_knowledge_like_kb"');
  });

  it('down：原样还原（IF NOT EXISTS），保持可回滚对称', async () => {
    const { queryRunner, query } = fakeQueryRunner([]);

    await migration.down(queryRunner);

    const sql = sqlCalls(query).join('\n');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_knowledge_documents_kb"',
    );
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_knowledge_like_kb"');
  });
});
