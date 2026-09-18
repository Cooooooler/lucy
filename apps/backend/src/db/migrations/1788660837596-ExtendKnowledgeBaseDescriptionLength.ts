import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendKnowledgeBaseDescriptionLength1788660837596 implements MigrationInterface {
  name = 'ExtendKnowledgeBaseDescriptionLength1788660837596';

  /** 显式原子化：迁移中途失败可整体回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" TYPE character varying(255)`,
    );
  }
}
