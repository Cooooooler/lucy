import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeTables1787750000000 implements MigrationInterface {
  name = 'CreateKnowledgeTables1787750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "original_name" character varying(255) NOT NULL, "ext" character varying(20) NOT NULL, "mime" character varying(100) NOT NULL, "size" integer NOT NULL, "key" character varying(255) NOT NULL, "hash" character(64) NOT NULL, "storage" character varying(20) NOT NULL DEFAULT 'local', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_files_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_files_owner" ON "files" ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_bases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "visibility" character varying(10) NOT NULL DEFAULT 'private', "name" character varying(100) NOT NULL, "description" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_bases_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_owner_visibility" ON "knowledge_bases" ("owner_id", "visibility") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "file_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "content" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_documents_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb" ON "knowledge_documents" ("knowledge_base_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb_created" ON "knowledge_documents" ("knowledge_base_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_file" ON "knowledge_documents" ("file_id") `,
    );
    // 外键
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD CONSTRAINT "FK_knowledge_bases_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP CONSTRAINT "FK_knowledge_bases_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_file"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_kb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_file"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_kb_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_knowledge_documents_kb"`);
    await queryRunner.query(`DROP TABLE "knowledge_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_owner_visibility"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_bases"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_files_owner"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
