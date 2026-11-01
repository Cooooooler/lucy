import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserEmailNormalizedCheck1793556218654 implements MigrationInterface {
  name = 'AddUserEmailNormalizedCheck1793556218654';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_1040bad89eccbf468a15885c1e" CHECK ("email" = btrim(lower("email"), E'\\t\\n\\r\\f\\u000B \\u00A0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_1040bad89eccbf468a15885c1e"`,
    );
  }
}
