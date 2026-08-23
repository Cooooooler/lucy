import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageTruncated1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_messages" ADD "truncated" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_messages" DROP COLUMN "truncated"`,
    );
  }
}
