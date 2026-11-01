import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserEmailNormalizedCheck1793555023061 implements MigrationInterface {
  name = 'AddUserEmailNormalizedCheck1793555023061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_c30728b009eefa08d087a7a62d" CHECK ("email" = btrim(lower("email")))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_c30728b009eefa08d087a7a62d"`,
    );
  }
}
