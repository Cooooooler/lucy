import { MigrationInterface, QueryRunner } from 'typeorm';

/** 索引定义集中一处：up()/down() 与有效性断言共用，避免三处名字/DDL 漂移 */
const KEYSET_INDEXES = [
  {
    name: 'IDX_knowledge_bases_owner_created_id',
    create: `CREATE INDEX CONCURRENTLY "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC)`,
  },
  {
    name: 'IDX_knowledge_bases_visibility_created_id',
    create: `CREATE INDEX CONCURRENTLY "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" ("visibility", "created_at" DESC, "id" DESC)`,
  },
  {
    name: 'IDX_knowledge_documents_kb_created_id',
    create: `CREATE INDEX CONCURRENTLY "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC, "id" DESC)`,
  },
] as const;

/** 缺 id 决胜列，无法覆盖 `ORDER BY created_at DESC, id DESC` 的键集定位，故删除 */
const LEGACY_DOC_INDEX = 'IDX_knowledge_documents_kb_created';
/** 单列 (knowledge_base_id) 索引：被新复合索引的前导列完全覆盖，属冗余索引（最热插入路径白付写入放大） */
const REDUNDANT_DOC_INDEX = 'IDX_knowledge_documents_kb';

/**
 * 游标分页（keyset）配套索引，与上一迁移 AlignKnowledgeTimestampsBackfill 拆分，
 * 使「建索引」不与「全表 UPDATE」同处一个事务：
 *
 * - `transaction = false`：TypeORM 不包整体事务，`CREATE/DROP INDEX CONCURRENTLY`
 *   才能执行（它们**禁止**出现在事务块内），且每条语句独立提交。
 * - `CONCURRENTLY`：建/删索引不阻塞表上的读写（不取 SHARE/ACCESS EXCLUSIVE 长锁）。
 *
 * 索引设计：排序键与索引列顺序一致，使列表查询成为一次索引扫描（无 visibility
 * 过滤时 `owner_id OR visibility = 'public'` 由两条索引走 BitmapOr）。
 *
 * —— 关于 `CREATE INDEX CONCURRENTLY` 的失败残留 ——
 * 它中途失败（死锁、被取消等）时不会回滚，而是留下一个同名 **INVALID** 索引：
 * 不参与查询计划、却占用名字。此时若用 `IF NOT EXISTS` 直接重跑，Postgres 只看
 * 名字是否存在便会**静默跳过**→ 重跑「成功」、迁移被记为已应用，库里却永久留着
 * 一个坏索引，keyset 分页退化为顺序扫描且无声无息。因此本迁移一律**先删后建**
 * （`DROP INDEX CONCURRENTLY IF EXISTS` + 无 IF NOT EXISTS 的 CREATE），并在最后
 * 断言 `pg_index.indisvalid`，让任何残留直接以报错收场。巡检语句：
 *   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
 */
export class AddKnowledgeKeysetIndexes1789600000000 implements MigrationInterface {
  name = 'AddKnowledgeKeysetIndexes1789600000000';

  /** 按语句自动提交：CONCURRENTLY 不能进事务块，每步独立提交。 */
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 先删两条不再需要的索引：缺 id 决胜列的旧索引，以及被新复合索引前导列覆盖的冗余单列索引
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${LEGACY_DOC_INDEX}"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${REDUNDANT_DOC_INDEX}"`,
    );

    // 2) 补三条 keyset 索引（逐条先删后建，吸收上一次失败留下的 INVALID 残留）
    for (const index of KEYSET_INDEXES) {
      await this.recreateIndex(queryRunner, index.name, index.create);
    }

    await this.assertIndexesValid(
      queryRunner,
      KEYSET_INDEXES.map((index) => index.name),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 对称还原：删三条 keyset 索引，恢复旧复合索引与单列索引
    for (const index of KEYSET_INDEXES) {
      await queryRunner.query(
        `DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`,
      );
    }
    await this.recreateIndex(
      queryRunner,
      LEGACY_DOC_INDEX,
      `CREATE INDEX CONCURRENTLY "${LEGACY_DOC_INDEX}" ON "knowledge_documents" ("knowledge_base_id", "created_at")`,
    );
    await this.recreateIndex(
      queryRunner,
      REDUNDANT_DOC_INDEX,
      `CREATE INDEX CONCURRENTLY "${REDUNDANT_DOC_INDEX}" ON "knowledge_documents" ("knowledge_base_id")`,
    );

    await this.assertIndexesValid(queryRunner, [
      LEGACY_DOC_INDEX,
      REDUNDANT_DOC_INDEX,
    ]);
  }

  /**
   * 先删后建：DROP 会连带清掉上一次失败留下的同名 INVALID 索引，
   * CREATE 刻意不带 `IF NOT EXISTS`——同名有效索引刚被删掉，此处若仍存在同名索引
   * 只可能是并发建索引的意外状态，应当报错而非静默跳过。
   */
  private async recreateIndex(
    queryRunner: QueryRunner,
    name: string,
    createSql: string,
  ): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    await queryRunner.query(createSql);
  }

  /**
   * 断言索引均已建成有效状态。`CREATE INDEX CONCURRENTLY` 的失败既有「抛错」也有
   * 「留下 INVALID 索引但流程继续」的形态，只靠语句本身不足以判定，故显式查一次目录。
   * @throws Error 存在 INVALID 索引（提示 DROP 后重跑）
   */
  private async assertIndexesValid(
    queryRunner: QueryRunner,
    names: readonly string[],
  ): Promise<void> {
    const invalid = (await queryRunner.query(
      `SELECT c.relname AS name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = ANY($1::text[])
          AND NOT i.indisvalid`,
      [names],
    )) as { name: string }[];
    if (invalid.length > 0) {
      throw new Error(
        `索引未建成有效状态：${invalid.map((row) => row.name).join(', ')}；` +
          `请 DROP INDEX CONCURRENTLY 后重跑本迁移`,
      );
    }
  }
}
