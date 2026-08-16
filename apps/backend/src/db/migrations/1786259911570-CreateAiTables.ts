import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiTables1786259911570 implements MigrationInterface {
  name = 'CreateAiTables1786259911570';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."ai_messages_role_enum" AS ENUM('user', 'ai', 'system')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ai_messages_status_enum" AS ENUM('complete', 'aborted', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "role" "public"."ai_messages_role_enum" NOT NULL, "content" text NOT NULL, "status" "public"."ai_messages_status_enum", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de21fcb2d1df7fd6ca70f555b6" ON "ai_messages"  ("conversation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_conversations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" bigint NOT NULL, "title" character varying(50), "model" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60db12765b82858ba00c8aa4ae2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_messages" ADD CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_messages" DROP CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
    );
    await queryRunner.query(`DROP TABLE "ai_conversations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de21fcb2d1df7fd6ca70f555b6"`,
    );
    await queryRunner.query(`DROP TABLE "ai_messages"`);
    await queryRunner.query(`DROP TYPE "public"."ai_messages_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ai_messages_role_enum"`);
  }
}
