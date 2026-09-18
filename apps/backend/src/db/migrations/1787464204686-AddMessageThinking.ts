import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageThinking1787464204686 implements MigrationInterface {
  /** 显式原子化：迁移中途失败可整体回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_messages" ADD "thinking" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_messages" DROP COLUMN "thinking"`);
  }
}
