import { MigrationInterface, QueryRunner } from 'typeorm';

/** 用户角色列：默认 user，admin 可访问用户管理接口。 */
export class AddUserRole1789200000000 implements MigrationInterface {
  name = 'AddUserRole1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" character varying(20) NOT NULL DEFAULT 'user'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
  }
}
