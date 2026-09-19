import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 清理两条被覆盖的冗余索引——**专为存量库收敛**：初始化迁移在存量库上只做 baseline
 * （`up()` 探测到 schema 已存在就跳过整段 DDL），因此新库里「没有这两条索引」这一事实
 * 不会自动落到存量库上。单独一个迁移同时作用于新库（空转）与存量库（真正删索引）。
 *
 * - `IDX_knowledge_documents_kb`（knowledge_documents.knowledge_base_id）：
 *   已被 `IDX_knowledge_documents_kb_created_id` 的前导列完全覆盖。
 * - `IDX_knowledge_like_kb`（knowledge_likes.knowledge_base_id）：
 *   已被 `UQ_knowledge_like (knowledge_base_id, user_id)` 的前导列完全覆盖。
 *
 * 两条都是纯写放大，删除不影响任何查询（计数/删除/级联都按前缀走那两个复合索引）。
 * down() 用 `IF NOT EXISTS` 原样还原，保持可回滚对称。
 */
const REDUNDANT_INDEXES = [
  {
    name: 'IDX_knowledge_documents_kb',
    table: 'knowledge_documents',
    column: 'knowledge_base_id',
  },
  {
    name: 'IDX_knowledge_like_kb',
    table: 'knowledge_likes',
    column: 'knowledge_base_id',
  },
] as const;

export class DropRedundantKnowledgeIndexes1789800000000 implements MigrationInterface {
  name = 'DropRedundantKnowledgeIndexes1789800000000';

  /** 显式原子化：删索引中途失败应整体回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const index of REDUNDANT_INDEXES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index.name}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of REDUNDANT_INDEXES) {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "${index.name}" ON "${index.table}" ("${index.column}")`,
      );
    }
  }
}
