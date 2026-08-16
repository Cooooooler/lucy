import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeUsersIdToUuid1786824993140 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // users.id 从 BIGSERIAL 自增改为 uuid，数据保持（回填 gen_random_uuid 再换列）
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb"`,
    );

    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "id_new" uuid`);
    await queryRunner.query(`UPDATE "users" SET "id_new" = gen_random_uuid()`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "id_new" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "user_id_new" uuid`,
    );
    await queryRunner.query(
      `UPDATE "ai_conversations" ac SET "user_id_new" = u."id_new" FROM "users" u WHERE ac."user_id" = u."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ALTER COLUMN "user_id_new" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT`,
    );
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "users_id_seq"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "id_new" TO "id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN "user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" RENAME COLUMN "user_id_new" TO "user_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // down 不做数据回迁（bigint 无法承载任意 uuid），按空表重建旧结构
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fdbf99ca0da93085d61edd3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN "user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "user_id" bigint NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "id" BIGSERIAL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
