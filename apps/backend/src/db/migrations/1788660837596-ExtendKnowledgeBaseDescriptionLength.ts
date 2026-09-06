import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendKnowledgeBaseDescriptionLength1788660837596 implements MigrationInterface {
  name = 'ExtendKnowledgeBaseDescriptionLength1788660837596';

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
