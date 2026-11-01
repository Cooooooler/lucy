import { MigrationInterface, QueryRunner } from 'typeorm';

export class KnowledgeRetrievalSettings1792957648141 implements MigrationInterface {
  name = 'KnowledgeRetrievalSettings1792957648141';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "retrieval_mode" character varying(10) NOT NULL DEFAULT 'fulltext'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "top_k" integer NOT NULL DEFAULT '5'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "score_threshold_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "score_threshold" real NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "semantic_weight" integer NOT NULL DEFAULT '50'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD "rerank_model_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_rerank_model" ON "knowledge_bases"  ("rerank_model_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD CONSTRAINT "FK_knowledge_bases_rerank_model" FOREIGN KEY ("rerank_model_id") REFERENCES "model_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP CONSTRAINT "FK_knowledge_bases_rerank_model"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_rerank_model"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "rerank_model_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "semantic_weight"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "score_threshold"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "score_threshold_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "top_k"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP COLUMN "retrieval_mode"`,
    );
  }
}
