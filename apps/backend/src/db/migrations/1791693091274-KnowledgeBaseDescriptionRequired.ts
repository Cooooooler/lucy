import { MigrationInterface, QueryRunner } from 'typeorm';

export class KnowledgeBaseDescriptionRequired1791693091274 implements MigrationInterface {
  name = 'KnowledgeBaseDescriptionRequired1791693091274';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 历史行可能为 NULL 或空串（描述原为可选列），描述现已要求非空：
    // 不能用空串回填（仍属空），统一以该行的名称兜底，否则 SET NOT NULL 会失败。
    // 这是 `migration:generate` 无法自动产出的数据回填，非 schema 声明。
    await queryRunner.query(
      `UPDATE "knowledge_bases" SET "description" = "name" WHERE "description" IS NULL OR "description" = ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ALTER COLUMN "description" DROP NOT NULL`,
    );
  }
}
