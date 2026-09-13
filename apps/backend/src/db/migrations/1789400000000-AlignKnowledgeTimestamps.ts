import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 游标分页的排序键改为不可变的 (created_at, id) 后，配套两件事：
 *
 * 1. **时间戳毫秒对齐**：keyset 谓词直接比较原始列（不再 `date_trunc`，否则谓词无法走索引）。
 *    游标编码精度是毫秒（JS Date 固有精度），若库里存在微秒时间戳——手写 SQL 的 seed
 *    用默认值 `now()` 就会产生——同一毫秒内、微秒更大的行会同时不满足 `<` 与 `=`，
 *    被整批跳过。故把两表两列的历史数据取整到毫秒，并把**列默认值**也改成毫秒对齐，
 *    保证今后任何手写 INSERT（不经过 TypeORM）也不会再引入微秒。
 *
 * 2. **补齐 keyset 分页索引**：`(owner_id/visibility, created_at DESC, id DESC)` 与
 *    `(knowledge_base_id, created_at DESC, id DESC)`——排序键与索引列顺序一致，
 *    使列表查询成为一次索引扫描（无 visibility 过滤时 `owner_id OR visibility = 'public'`
 *    由两条索引走 BitmapOr）。同时删掉被取代的 `IDX_knowledge_documents_kb_created`
 *    （缺 id 决胜列，无法覆盖 `ORDER BY created_at DESC, id DESC` 的键集定位）。
 */
export class AlignKnowledgeTimestamps1789400000000 implements MigrationInterface {
  name = 'AlignKnowledgeTimestamps1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 默认值毫秒对齐（今后手写 SQL 也只会写入毫秒精度）
    for (const table of ['knowledge_bases', 'knowledge_documents']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "created_at" SET DEFAULT date_trunc('milliseconds', now())`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updated_at" SET DEFAULT date_trunc('milliseconds', now())`,
      );
      // 2) 历史数据取整到毫秒
      await queryRunner.query(
        `UPDATE "${table}" SET "created_at" = date_trunc('milliseconds', "created_at"), "updated_at" = date_trunc('milliseconds', "updated_at")`,
      );
    }

    // 3) keyset 分页索引
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" ("visibility", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_kb_created"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 索引对称还原
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb_created" ON "knowledge_documents" ("knowledge_base_id", "created_at")`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_kb_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_visibility_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_owner_created_id"`,
    );
    // 默认值改回 now()；时间戳的具体取整不可逆（原始微秒值已丢失），故不还原数据。
    for (const table of ['knowledge_bases', 'knowledge_documents']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "created_at" SET DEFAULT now()`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updated_at" SET DEFAULT now()`,
      );
    }
  }
}
