import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeLikes1789000000000 implements MigrationInterface {
  name = 'CreateKnowledgeLikes1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "knowledge_likes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_likes_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_like_kb" ON "knowledge_likes" ("knowledge_base_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_likes" ADD CONSTRAINT "UQ_knowledge_like" UNIQUE ("knowledge_base_id", "user_id")`,
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
    await queryRunner.query(`DROP TABLE "knowledge_likes"`);
  }
}
