import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageThinking1787464204686 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_messages" ADD "thinking" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_messages" DROP COLUMN "thinking"`);
  }
}
