import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdjustKnowledgeBaseDescriptionLength2001788661954653 implements MigrationInterface {
  name = 'AdjustKnowledgeBaseDescriptionLength2001788661954653';

  /** 显式原子化：截断 + 缩列必须整体生效（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先截断超过 200 字符的描述，再缩小列宽
    await queryRunner.query(
      `UPDATE "knowledge_bases" SET "description" = LEFT("description", 200) WHERE LENGTH("description") > 200`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" TYPE character varying(200)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" TYPE character varying(500)`,
    );
  }
}
