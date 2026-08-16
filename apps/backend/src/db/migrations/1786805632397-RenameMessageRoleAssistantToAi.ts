import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameMessageRoleAssistantToAi1786805632397 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 幂等处理：仅当枚举当前仍含 'assistant'（历史库）时才重命名。
    // 新库的 CreateAiTables 已直接建为 'ai'，此处静默跳过，避免 RENAME VALUE 报错。
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_enum e
           JOIN pg_type t ON e.enumtypid = t.oid
           WHERE t.typname = 'ai_messages_role_enum'
             AND e.enumlabel = 'assistant'
         ) THEN
           ALTER TYPE "public"."ai_messages_role_enum" RENAME VALUE 'assistant' TO 'ai';
         END IF;
       END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_enum e
           JOIN pg_type t ON e.enumtypid = t.oid
           WHERE t.typname = 'ai_messages_role_enum'
             AND e.enumlabel = 'ai'
         ) THEN
           ALTER TYPE "public"."ai_messages_role_enum" RENAME VALUE 'ai' TO 'assistant';
         END IF;
       END $$`,
    );
  }
}
