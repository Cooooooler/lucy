import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationKeysetIndex1789827976863 implements MigrationInterface {
  name = 'AddConversationKeysetIndex1789827976863';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
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
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations" USING btree ("user_id") `,
    );
  }
}
