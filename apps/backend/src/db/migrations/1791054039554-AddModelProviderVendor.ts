import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelProviderVendor1791054039554 implements MigrationInterface {
  name = 'AddModelProviderVendor1791054039554';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "model_providers" ADD "vendor" character varying(20) NOT NULL DEFAULT 'openai'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "model_providers" DROP COLUMN "vendor"`,
    );
  }
}
