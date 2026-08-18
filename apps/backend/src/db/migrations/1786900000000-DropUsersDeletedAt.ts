import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUsersDeletedAt1786900000000 implements MigrationInterface {
  name = 'DropUsersDeletedAt1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }
}
