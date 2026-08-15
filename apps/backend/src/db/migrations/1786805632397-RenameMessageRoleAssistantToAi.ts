import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameMessageRoleAssistantToAi1786805632397 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 既有库的 ai_messages_role_enum 仍是 ('user','assistant','system')，
    // 行内重命名枚举值：存量 'assistant' 行自动转为 'ai'，类型亦移除 'assistant'
    await queryRunner.query(
      `ALTER TYPE "public"."ai_messages_role_enum" RENAME VALUE 'assistant' TO 'ai'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."ai_messages_role_enum" RENAME VALUE 'ai' TO 'assistant'`,
    );
  }
}
