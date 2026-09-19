import type { MigrationInterface, QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { KEYSET_INDEXES } from './keyset-indexes.js';
import { InitSchema1789700000000 } from './migrations/1789700000000-InitSchema.js';
import { DropRedundantKnowledgeIndexes1789800000000 } from './migrations/1789800000000-DropRedundantKnowledgeIndexes.js';
import { ConvergeKnowledgeKeysetIndexes1789900000000 } from './migrations/1789900000000-ConvergeKnowledgeKeysetIndexes.js';
import { ConvergeKnowledgeMillisDefaults1789910000000 } from './migrations/1789910000000-ConvergeKnowledgeMillisDefaults.js';

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

/** 索引在库里的形态（与收敛迁移 describe() 的返回同形：列序 + 与之一一对应的方向） */
interface IndexShape {
  table: string;
  isValid: boolean;
  columns: string[];
  descending: boolean[];
}

/** 目标形态：三条索引都存在、有效、列序与方向与规范定义一致 */
function convergedShapes(): Record<string, IndexShape> {
  return Object.fromEntries(
    KEYSET_INDEXES.map((spec) => [
      spec.name,
      {
        table: spec.table,
        isValid: true,
        columns: spec.columns.map((column) => column.name),
        descending: spec.columns.map((column) => column.desc === true),
      },
    ]),
  );
}

/**
 * 索引收敛迁移的假库：`describe()` 的聚合查询按索引名返回预置形态，CREATE/DROP 会更新它，
 * 从而能在没有真库的情况下走完「探测 → 修形态 → 收尾校验」整条路径。
 * `applyDdl = false` 用来模拟「DDL 执行了但库里形态仍不对」，验证收尾校验真的会拦下来。
 */
function indexShapeRunner(
  initial: Record<string, IndexShape>,
  applyDdl = true,
): { queryRunner: QueryRunner; sql: string[] } {
  const shapes = new Map(Object.entries(initial));
  const sql: string[] = [];
  const query = vi.fn((statement: string, params?: unknown[]) => {
    sql.push(statement);
    if (statement.includes('indisvalid')) {
      const shape = shapes.get(String(params?.[0]));
      return shape ? [{ ...shape }] : [];
    }
    if (!applyDdl) return [];
    const created =
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS "([^"]+)" ON "([^"]+)" \(([^)]+)\)/.exec(
        statement,
      );
    if (created) {
      const parts = created[3]
        .split(',')
        .map((part) => part.replace(/"/g, '').replace(/\s+/g, ' ').trim());
      shapes.set(created[1], {
        table: created[2],
        isValid: true,
        columns: parts.map((part) => part.replace(/ DESC$/, '')),
        descending: parts.map((part) => part.endsWith(' DESC')),
      });
    }
    const dropped = /DROP INDEX CONCURRENTLY IF EXISTS "([^"]+)"/.exec(
      statement,
    );
    if (dropped) shapes.delete(dropped[1]);
    return [];
  });
  return { queryRunner: { query } as unknown as QueryRunner, sql };
}

/** 只看索引 DDL（探测与校验查询会混在同一串里） */
const indexDdl = (sql: string[]): string[] =>
  sql.filter((statement) => /^(CREATE|DROP) INDEX/.test(statement));

describe('存量库 keyset 索引收敛迁移', () => {
  // 声明成接口类型：两个收敛迁移的 down() 是无参空操作（刻意忽略 QueryRunner），
  // 按接口调用才能同时断言 transaction 与 down() 行为
  const migration: MigrationInterface =
    new ConvergeKnowledgeKeysetIndexes1789900000000();

  it('裸跑且用 CONCURRENTLY：建索引的锁不能持到提交（否则存量库部署级写阻塞）', () => {
    expect(migration.transaction).toBe(false);
  });

  it('up：三条索引已是目标形态 → 空转，不执行任何索引 DDL', async () => {
    const { queryRunner, sql } = indexShapeRunner(convergedShapes());

    await migration.up(queryRunner);

    expect(indexDdl(sql)).toEqual([]);
  });

  it('up：形态不符（DESC 被换成 ASC）→ 先 DROP 再重建，而不是被 IF NOT EXISTS 静默跳过', async () => {
    const shapes = convergedShapes();
    shapes.IDX_knowledge_bases_owner_created_id.columns = [
      'owner_id',
      'created_at',
      'id',
    ];
    shapes.IDX_knowledge_bases_owner_created_id.descending = [
      false,
      false,
      false,
    ];
    const { queryRunner, sql } = indexShapeRunner(shapes);

    await migration.up(queryRunner);

    expect(indexDdl(sql)).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_knowledge_bases_owner_created_id"',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC)',
    ]);
  });

  it('up：上次 CONCURRENTLY 失败留下的 INVALID 索引 → 同样先删再建', async () => {
    const shapes = convergedShapes();
    shapes.IDX_knowledge_documents_kb_created_id.isValid = false;
    const { queryRunner, sql } = indexShapeRunner(shapes);

    await migration.up(queryRunner);

    expect(indexDdl(sql)).toHaveLength(2);
    expect(indexDdl(sql)[0]).toContain('DROP INDEX CONCURRENTLY');
  });

  it('up：DDL 执行后形态仍不对（缺失/INVALID/列不符）→ 抛错，不留「迁移记成功」的假象', async () => {
    const { queryRunner } = indexShapeRunner({}, false);

    await expect(migration.up(queryRunner)).rejects.toThrow(/未收敛到声明形态/);
  });

  it('down：刻意的空操作——判据无法区分「本迁移建的索引」与「存量库本来就有的」', async () => {
    const { queryRunner, sql } = indexShapeRunner(convergedShapes());

    await migration.down(queryRunner);

    expect(sql).toEqual([]);
  });
});

describe('存量库毫秒默认值收敛迁移', () => {
  const migration: MigrationInterface =
    new ConvergeKnowledgeMillisDefaults1789910000000();

  it('原子迁移（四条 SET DEFAULT 要么全成、要么全回滚）', () => {
    expect(migration.transaction).toBe(true);
  });

  it('up：四条时间列都收敛到毫秒对齐默认值', async () => {
    const { queryRunner, query } = fakeQueryRunner([]);

    await migration.up(queryRunner);

    const sql = sqlCalls(query).join('\n');
    for (const [
      table,
      column,
    ] of ConvergeKnowledgeMillisDefaults1789910000000.COLUMNS) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT date_trunc('milliseconds', now())`,
      );
    }
  });

  it('down：刻意的空操作（理由同索引收敛迁移）', async () => {
    const { queryRunner, query } = fakeQueryRunner([]);

    await migration.down(queryRunner);

    expect(sqlCalls(query)).toEqual([]);
  });
});
