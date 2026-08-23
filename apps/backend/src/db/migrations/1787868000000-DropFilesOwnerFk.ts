import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 撤销 files.owner_id → users 的外键。
 *
 * FileEntity 属于通用 @coool/file-nest 包，ownerId 仅作为描述元数据（文件属主用户 ID）落库，
 * 包层面并不建模到 users 的关系（file-nest 不依赖后端 User 实体）。任务 14 手写迁移时在
 * files 表额外补了这条外键，导致实体元数据（无该关系）与库 schema（有该外键）漂移，
 * 每次 migration:generate 都会重复提出 DROP。按 file-nest 的通用语义，外键职责应留在
 * 业务侧（KnowledgeService 在应用层做属主校验），故在此移除，避免 schema 漂移。
 *
 * 注：files/知识库各表当前均为空表（0 行），移除该外键无任何数据/孤儿风险。
 */
export class DropFilesOwnerFk1787868000000 implements MigrationInterface {
  name = 'DropFilesOwnerFk1787868000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
