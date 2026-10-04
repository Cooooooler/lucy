import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationModelProvider1791140675724 implements MigrationInterface {
  name = 'ConversationModelProvider1791140675724';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN "model"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD "model_provider_id" uuid`,
    );
    // FK 列自带索引：删除 ModelProvider 时 ON DELETE SET NULL 需按该列定位引用行
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_conversations_model_provider" ON "ai_conversations"  ("model_provider_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_ai_conversations_model_provider" FOREIGN KEY ("model_provider_id") REFERENCES "model_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP CONSTRAINT "FK_ai_conversations_model_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_conversations_model_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN "model_provider_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD "model" character varying`,
    );
  }
}
