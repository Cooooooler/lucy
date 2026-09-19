import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationKeysetIndexAndTimestampPrecision1789829610282 implements MigrationInterface {
  name = 'ConversationKeysetIndexAndTimestampPrecision1789829610282';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
    );
    // 存量行归一化：建表时两列是 DEFAULT now()（微秒），而 keyset 游标是毫秒精度 —— 亚毫秒
    // 时间戳会被游标向下截断，同一毫秒内的行在下一页被静默跳过（本迁移要消除的正是这个）。
    // 单向修正：down() 无法还原原精度。表规模小（每用户会话数有限），单条 UPDATE 即可
    await queryRunner.query(
      `UPDATE "ai_conversations" SET "created_at" = date_trunc('milliseconds', "created_at"), "updated_at" = date_trunc('milliseconds', "updated_at")`,
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
