import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { InitSchema1789700000000 } from './migrations/1789700000000-InitSchema.js';

/**
 * 初始化迁移是**全库唯一的迁移**，也是「当前结构」的唯一定义处。它被改坏（漏表、漏索引、
 * 时间列精度退回微秒）时全新库会跟着一起歪，而这类问题只有在真库上跑完才暴露得出来——
 * 这里用假 QueryRunner 把 DDL 的契约钉在源码层面，出问题时能立刻指认是哪一处被改掉。
 *
 * 断言的是**语义要点**而不是逐字全文：全文比对会让任何一次加列/加表都要改测试，
 * 反而促成「测试跟着实现改」；下面几条是结构里真正不可退让的部分（见迁移文件的注释）。
 */
function fakeQueryRunner(): {
  queryRunner: QueryRunner;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue([]);
  return { queryRunner: { query } as unknown as QueryRunner, query };
}

/** 取出被执行的 SQL 语句 */
const sqlCalls = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map((call) => String(call[0]));

/** DDL 里建出的表（含 AI、文件、知识库三块） */
const TABLES = [
  'users',
  'ai_conversations',
  'ai_messages',
  'files',
  'knowledge_bases',
  'knowledge_documents',
  'knowledge_likes',
];

/** 三条 keyset 索引：列序与 DESC 方向必须与游标谓词 `(created_at, id) < (…)` 对得上 */
const KEYSET_INDEXES = [
  /CREATE INDEX "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" \("owner_id", "created_at" DESC, "id" DESC\)/,
  /CREATE INDEX "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" \("visibility", "created_at" DESC, "id" DESC\)/,
  /CREATE INDEX "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" \("knowledge_base_id", "created_at" DESC, "id" DESC\)/,
];

describe('InitSchema（全库唯一的迁移）', () => {
  const migration = new InitSchema1789700000000();

  it('transaction = true：多语句 DDL 要么全成、要么全回滚', () => {
    expect(migration.transaction).toBe(true);
  });

  it('up：一条语句建出全部表（DDL 收在一条多语句 SQL 里，见迁移文件头说明）', async () => {
    const { queryRunner, query } = fakeQueryRunner();

    await migration.up(queryRunner);

    const sql = sqlCalls(query);
    expect(sql).toHaveLength(1);
    const ddl = sql[0];
    for (const table of TABLES) {
      expect(ddl, `up() 没有建出 ${table}`).toContain(
        `CREATE TABLE "${table}"`,
      );
    }
  });

  it('up：三条 keyset 索引都是 created_at DESC, id DESC（migration:generate 的 ASC 提案必须被拒）', async () => {
    const { queryRunner, query } = fakeQueryRunner();

    await migration.up(queryRunner);

    const ddl = sqlCalls(query).join('\n');
    for (const pattern of KEYSET_INDEXES) {
      expect(
        ddl.match(pattern)?.[0],
        `keyset 索引形态变了：${pattern.source}\n` +
          `游标分页依赖这个列序与方向，若是 migration:generate 提出的 ASC 版本请拒绝`,
      ).toBeDefined();
    }
  });

  it('up：两个知识库表的时间列默认值毫秒对齐（微秒会让游标在同一毫秒内跳行）', async () => {
    const { queryRunner, query } = fakeQueryRunner();

    await migration.up(queryRunner);

    const ddl = sqlCalls(query).join('\n');
    const millisecondDefaults =
      ddl.match(/DEFAULT date_trunc\('milliseconds', now\(\)\)/g) ?? [];
    // knowledge_bases / knowledge_documents 各 created_at + updated_at
    expect(millisecondDefaults).toHaveLength(4);

    // 只对这两张表收紧：其余表（users / files / ai_*）用 now() 是本来的设计，
    // 全局否定会误伤它们，所以按建表语句逐行检查
    const knowledgeTables = ddl
      .split('\n')
      .filter((line) =>
        /CREATE TABLE "knowledge_(bases|documents)"/.test(line),
      );
    expect(knowledgeTables).toHaveLength(2);
    for (const line of knowledgeTables) {
      expect(line).not.toContain('DEFAULT now()');
      expect(
        line.match(/DEFAULT date_trunc\('milliseconds', now\(\)\)/g),
      ).toHaveLength(2);
    }
  });

  it('down：逆依赖顺序整库拆掉，create → revert → 重跑 的往返可用', async () => {
    const { queryRunner, query } = fakeQueryRunner();

    await migration.down(queryRunner);

    const sql = sqlCalls(query);
    expect(sql).toHaveLength(1);
    const ddl = sql[0];
    for (const table of TABLES) {
      expect(ddl).toContain(`DROP TABLE "${table}"`);
    }
    expect(ddl).toContain('DROP TYPE "public"."ai_messages_status_enum"');
    expect(ddl).toContain('DROP TYPE "public"."ai_messages_role_enum"');
    // 引用方必须先拆：documents 依赖 knowledge_bases，likes 依赖两个表
    const at = (table: string): number => ddl.indexOf(`DROP TABLE "${table}"`);
    expect(at('knowledge_documents')).toBeLessThan(at('knowledge_bases'));
    expect(at('knowledge_likes')).toBeLessThan(at('knowledge_bases'));
    expect(at('ai_messages')).toBeLessThan(at('ai_conversations'));
  });
});
