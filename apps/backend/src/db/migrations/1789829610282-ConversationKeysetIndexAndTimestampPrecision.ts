import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationKeysetIndexAndTimestampPrecision1789829610282 implements MigrationInterface {
  name = 'ConversationKeysetIndexAndTimestampPrecision1789829610282';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ALTER COLUMN "created_at" SET DEFAULT date_trunc('milliseconds', now())`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ALTER COLUMN "updated_at" SET DEFAULT date_trunc('milliseconds', now())`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_conversations_user_updated_id" ON "ai_conversations"  ("user_id", "updated_at", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_conversations_user_updated_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ALTER COLUMN "updated_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ALTER COLUMN "created_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations" USING btree ("user_id") `,
    );
  }
}
