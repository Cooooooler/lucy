import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessagesConversationCreatedIndex1786260204180 implements MigrationInterface {
  name = 'AddMessagesConversationCreatedIndex1786260204180';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de21fcb2d1df7fd6ca70f555b6"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_messages_conversation_created" ON "ai_messages"  ("conversation_id", "created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_messages_conversation_created"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de21fcb2d1df7fd6ca70f555b6" ON "ai_messages" USING btree ("conversation_id") `,
    );
  }
}
