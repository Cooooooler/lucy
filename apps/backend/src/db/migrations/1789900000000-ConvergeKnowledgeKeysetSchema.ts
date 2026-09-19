import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把**存量库**补齐到初始化迁移声明的结构——专治「新库有、旧库没有」的漂移。
 *
 * 为什么需要它：迁移历史压缩后，`InitSchema.up()` 在存量库上只做 baseline（探测到 schema
 * 已存在就跳过整段 DDL），后续那条收敛迁移又只删不建。于是「只跑到某条旧迁移为止」的库
 * （备份恢复、跳过过某次发布的库）会缺下面这些东西，而 `synchronize: false` 不会补：
 *
 * 1. 三条 keyset 索引——缺失时 `visibility = 'public'` / `owner_id` 两个过滤分支在游标分页下
 *    没有可用索引，默认分支还要在全量匹配集上排序后才 `LIMIT`，新分页的性能设计只对空库成立；
 * 2. `knowledge_bases`/`knowledge_documents` 时间列的毫秒对齐默认值——旧迁移建的是 `now()`，
 *    而 keyset 游标是毫秒精度，默认值写微秒会让 `(created_at, id) < (:cursorTs, :cursorId)`
 *    在同一毫秒内整批跳行。
 *
 * 全部语句都是幂等的（`IF NOT EXISTS` / `SET DEFAULT` 天然幂等），因此对「已经跑完旧迁移链
 * 的完整库」与全新库都是空转，只有真正缺东西的库才会被改动。
 *
 * 索引刻意用**非 CONCURRENTLY**：本迁移在正常环境是空转，只有「确实缺索引」的库才会真正建，
 * 而那种库的表规模通常不大；用 CONCURRENTLY 需要 `transaction = false` + 白名单 + 处理
 * INVALID 残留，收益与成本不匹配。若某个环境的表已经很大，应单独写一条 CONCURRENTLY 迁移。
 *
 * `down()` 是**刻意的空操作**：本迁移只做「补齐到声明式 schema」，它补的索引与默认值都归
 * InitSchema 所有——撤销时删掉它们会让全新库失去 keyset 索引。要回退整库请用
 * `InitSchema.down()`（它在全新库上才会真正拆库）。
 */
export class ConvergeKnowledgeKeysetSchema1789900000000 implements MigrationInterface {
  name = 'ConvergeKnowledgeKeysetSchema1789900000000';

  /** 原样重建三条 keyset 索引（与 InitSchema 的 DDL 保持一致：DESC, DESC） */
  static readonly KEYSET_INDEXES = [
    `CREATE INDEX IF NOT EXISTS "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" ("visibility", "created_at" DESC, "id" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC, "id" DESC)`,
  ] as const;

  /** 需要毫秒对齐默认值的时间列（表 → 列） */
  static readonly MILLISECOND_DEFAULT_COLUMNS = [
    ['knowledge_bases', 'created_at'],
    ['knowledge_bases', 'updated_at'],
    ['knowledge_documents', 'created_at'],
    ['knowledge_documents', 'updated_at'],
  ] as const;

  /** 显式原子化：这些 DDL 要么全成、要么全回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const index of ConvergeKnowledgeKeysetSchema1789900000000.KEYSET_INDEXES) {
      await queryRunner.query(index);
    }
    for (const [
      table,
      column,
    ] of ConvergeKnowledgeKeysetSchema1789900000000.MILLISECOND_DEFAULT_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT date_trunc('milliseconds', now())`,
      );
    }

    // 断言索引真的可用（存在但 INVALID 的索引等于没有）：与 AddKnowledgeKeysetIndexes
    // 当年那条迁移同样的收尾手法，避免「迁移记成功、查询却退化为顺序扫描」。
    const invalid = (await queryRunner.query(
      `SELECT c.relname AS name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = ANY($1::text[])
          AND NOT i.indisvalid`,
      [
        ConvergeKnowledgeKeysetSchema1789900000000.KEYSET_INDEXES.map(
          extractIndexName,
        ),
      ],
    )) as { name: string }[];
    if (invalid.length > 0) {
      throw new Error(
        `keyset 索引未建成有效状态：${invalid.map((row) => row.name).join(', ')}`,
      );
    }
  }

  public async down(): Promise<void> {
    // 刻意空操作，理由见类注释：补齐的东西归 InitSchema 所有，撤销这里会破坏全新库。
  }
}

/** 从 `CREATE INDEX IF NOT EXISTS "name" ON ...` 里取出索引名 */
function extractIndexName(createSql: string): string {
  const match = /CREATE INDEX IF NOT EXISTS "([^"]+)"/.exec(createSql);
  if (!match) throw new Error(`无法从 DDL 里解析索引名：${createSql}`);
  return match[1];
}
