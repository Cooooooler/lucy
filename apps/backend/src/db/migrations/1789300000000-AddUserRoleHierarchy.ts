import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 角色层级（user < admin < superadmin）：
 * 1. 加 CHECK 约束，把 role 取值收敛到三个合法角色；
 * 2. 将开发者账户提升为 superadmin——superadmin 没有创建/提升接口（避免提权面），
 *    其他环境需自行执行 UPDATE 提升本账号，详见
 *    docs/superpowers/specs/2026-09-11-user-role-hierarchy-design.md §4。
 */
export class AddUserRoleHierarchy1789300000000 implements MigrationInterface {
  name = 'AddUserRoleHierarchy1789300000000';

  private static readonly BOOTSTRAP_SUPERADMIN_ID =
    '69c2ec06-0552-4bdc-af29-d867f0f239f0';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('user', 'admin', 'superadmin'))`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'superadmin' WHERE "id" = $1`,
      [AddUserRoleHierarchy1789300000000.BOOTSTRAP_SUPERADMIN_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'user' WHERE "id" = $1 AND "role" = 'superadmin'`,
      [AddUserRoleHierarchy1789300000000.BOOTSTRAP_SUPERADMIN_ID],
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
  }
}
