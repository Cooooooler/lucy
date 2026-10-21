import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDefaultModels1792513987842 implements MigrationInterface {
  name = 'AddUserDefaultModels1792513987842';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_default_models" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "model_provider_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "UQ_e464cb31702d0d59ef4b6a5ebc9" UNIQUE ("owner_id", "model_provider_id"), CONSTRAINT "PK_57ffe4d8e061d080ba4703e465a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_default_models_model_provider" ON "user_default_models"  ("model_provider_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_default_models" ADD CONSTRAINT "FK_user_default_models_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_default_models" ADD CONSTRAINT "FK_user_default_models_model_provider" FOREIGN KEY ("model_provider_id") REFERENCES "model_providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_default_models" DROP CONSTRAINT "FK_user_default_models_model_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_default_models" DROP CONSTRAINT "FK_user_default_models_owner"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_default_models_model_provider"`,
    );
    await queryRunner.query(`DROP TABLE "user_default_models"`);
  }
}
