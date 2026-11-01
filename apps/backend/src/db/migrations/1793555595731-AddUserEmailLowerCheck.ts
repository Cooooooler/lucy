import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserEmailLowerCheck1793555595731 implements MigrationInterface {
  name = 'AddUserEmailLowerCheck1793555595731';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_90033ffeb5b67effb487588d20" CHECK ("email" = lower("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_90033ffeb5b67effb487588d20"`,
    );
  }
}
