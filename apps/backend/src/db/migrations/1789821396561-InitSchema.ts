import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1789821396561 implements MigrationInterface {
  name = 'InitSchema1789821396561';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" character varying(50) NOT NULL, "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "nickname" character varying(50), "status" smallint NOT NULL DEFAULT '1', "role" character varying(20) NOT NULL DEFAULT 'user', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ai_messages_role_enum" AS ENUM('user', 'ai', 'system')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ai_messages_status_enum" AS ENUM('complete', 'aborted', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "role" "public"."ai_messages_role_enum" NOT NULL, "content" text NOT NULL, "thinking" text, "status" "public"."ai_messages_status_enum", "truncated" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_messages_conversation_created" ON "ai_messages"  ("conversation_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_conversations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "title" character varying(50), "model" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60db12765b82858ba00c8aa4ae2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "original_name" character varying(255) NOT NULL, "ext" character varying(20) NOT NULL, "mime" character varying(100) NOT NULL, "size" integer NOT NULL, "key" character varying(255) NOT NULL, "hash" character(64) NOT NULL, "storage" character varying(20) NOT NULL DEFAULT 'local', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_files_owner" ON "files"  ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_bases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "visibility" character varying(10) NOT NULL DEFAULT 'private', "name" character varying(100) NOT NULL, "description" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "PK_b7da0ee578e15ebb6213465440d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases"  ("visibility", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases"  ("owner_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_owner_visibility" ON "knowledge_bases"  ("owner_id", "visibility") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "file_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "content" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "PK_402a3c43fb263aa5289670e4e21" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_file" ON "knowledge_documents"  ("file_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents"  ("knowledge_base_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_likes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_knowledge_like" UNIQUE ("knowledge_base_id", "user_id"), CONSTRAINT "PK_adffb1dccd2cbca7911c0d32244" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_messages" ADD CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD CONSTRAINT "FK_knowledge_bases_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_likes" ADD CONSTRAINT "FK_knowledge_likes_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_likes" ADD CONSTRAINT "FK_knowledge_likes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_likes" DROP CONSTRAINT "FK_knowledge_likes_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_likes" DROP CONSTRAINT "FK_knowledge_likes_kb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_file"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_kb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP CONSTRAINT "FK_knowledge_bases_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_messages" DROP CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_likes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_kb_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_file"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_owner_visibility"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_owner_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_visibility_created_id"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_bases"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_files_owner"`);
    await queryRunner.query(`DROP TABLE "files"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
    );
    await queryRunner.query(`DROP TABLE "ai_conversations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_messages_conversation_created"`,
    );
    await queryRunner.query(`DROP TABLE "ai_messages"`);
    await queryRunner.query(`DROP TYPE "public"."ai_messages_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ai_messages_role_enum"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
