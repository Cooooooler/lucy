import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUsersDeletedAt1786900000000 implements MigrationInterface {
  name = 'DropUsersDeletedAt1786900000000';

  /** 显式原子化：迁移中途失败可整体回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }
}
