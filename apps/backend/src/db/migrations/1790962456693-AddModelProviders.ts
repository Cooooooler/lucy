import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelProviders1790962456693 implements MigrationInterface {
  name = 'AddModelProviders1790962456693';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "model_providers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "type" character varying(20) NOT NULL, "base_url" character varying(500) NOT NULL, "protocol" character varying(20) NOT NULL DEFAULT 'chat-completions', "context_length" integer NOT NULL, "api_key_encrypted" text NOT NULL, "api_key_last4" character varying(8) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "PK_5620fd1368e2e8c95bc1a6c3337" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_model_providers_owner_type" ON "model_providers"  ("owner_id", "type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_model_providers_owner_created_id" ON "model_providers"  ("owner_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "model_providers" ADD CONSTRAINT "FK_model_providers_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "model_providers" DROP CONSTRAINT "FK_model_providers_owner"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_model_providers_owner_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_model_providers_owner_type"`,
    );
    await queryRunner.query(`DROP TABLE "model_providers"`);
  }
}
