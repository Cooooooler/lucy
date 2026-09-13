import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 游标分页（keyset）配套索引，与上一迁移 AlignKnowledgeTimestampsBackfill 拆分，
 * 使「建索引」不与「全表 UPDATE」同处一个事务：
 *
 * - `transaction = false`：TypeORM 不包整体事务，`CREATE/DROP INDEX CONCURRENTLY`
 *   才能执行（它们**禁止**出现在事务块内），且每条语句独立提交。
 * - `CONCURRENTLY`：建/删索引不阻塞表上的读写（不取 SHARE/ACCESS EXCLUSIVE 长锁）。
 *
 * 索引设计：排序键与索引列顺序一致，使列表查询成为一次索引扫描（无 visibility
 * 过滤时 `owner_id OR visibility = 'public'` 由两条索引走 BitmapOr）。旧索引
 * `IDX_knowledge_documents_kb_created` 缺 id 决胜列，无法覆盖
 * `ORDER BY created_at DESC, id DESC` 的键集定位，故删除。
 *
 * —— 运维注意 ——
 * `CREATE INDEX CONCURRENTLY` 若中途失败（如死锁、被取消、唯一性冲突），会在库里
 * 留下一个 **INVALID** 的索引：它不参与查询计划，但占用名称、阻塞同名重建。
 * 恢复方式：`DROP INDEX CONCURRENTLY "<name>"` 后重跑本迁移。
 * 因此下面的语句一律用 `IF NOT EXISTS` / `IF EXISTS` 做幂等兜底，允许安全重跑。
 * 同理，本迁移执行后可用下面这条 SQL 巡检是否残留 INVALID 索引：
 *   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
 */
export class AddKnowledgeKeysetIndexes1789600000000 implements MigrationInterface {
  name = 'AddKnowledgeKeysetIndexes1789600000000';

  /** 按语句自动提交：CONCURRENTLY 不能进事务块，每步独立提交。 */
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先删旧索引（缺 id 决胜列），再补三条 keyset 索引。
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_knowledge_documents_kb_created"`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" ("visibility", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 对称还原：删三条 keyset 索引，恢复旧索引。
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_knowledge_documents_kb_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_knowledge_bases_visibility_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_knowledge_bases_owner_created_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_knowledge_documents_kb_created" ON "knowledge_documents" ("knowledge_base_id", "created_at")`,
    );
  }
}
