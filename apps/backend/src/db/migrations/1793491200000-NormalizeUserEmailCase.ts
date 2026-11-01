import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 邮箱大小写不敏感：把存量 `users.email` 归一为小写。
 *
 * 归一后，写入侧（注册 DTO / `UsersService.create`）只落小写、登录侧对含 `@` 的 account
 * 也转小写再等值查询——「仅大小写不同的重复账号」与小写登录 401 一并消失。
 *
 * 但直接 UPDATE 可能撞 `users.email` 上的唯一约束（原本就存在仅大小写不同的两行）：
 * 此处先显式检测，命中则以 **清楚列出待合并账号** 的错误中止迁移（TypeORM 迁移在事务里，
 * 不会留下半归一状态），由人工决定保留哪个账号、如何迁移其关联数据后再重跑。
 *
 * 不额外建 `lower(email)` 函数索引：实体无法表达函数索引，下一次 `migration:generate`
 * 会把它当成「元数据里没有的索引」删掉（实体是 schema 唯一来源，见 AGENTS.md）。
 * 大小写不敏感的唯一性由「写入一律归一 + 原有唯一约束」共同保证。
 */
export class NormalizeUserEmailCase1793491200000 implements MigrationInterface {
  name = 'NormalizeUserEmailCase1793491200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflicts = (await queryRunner.query(
      `SELECT lower("email") AS "email", array_agg("username") AS "usernames", count(*) AS "count"
         FROM "users"
        GROUP BY lower("email")
       HAVING count(*) > 1
        ORDER BY lower("email")`,
    )) as { email: string; usernames: string[]; count: string }[];

    if (conflicts.length > 0) {
      const detail = conflicts
        .map(
          (row) =>
            `${row.email}（${row.count} 条：${row.usernames.join('、')}）`,
        )
        .join('；');
      throw new Error(
        `users.email 存在仅大小写不同的重复账号，请先人工合并保留项与关联数据，再执行迁移：${detail}`,
      );
    }

    await queryRunner.query(
      `UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email")`,
    );
  }

  /**
   * 原始大小写不可恢复（未保留副本），故为 no-op：保留方法只为满足 `MigrationInterface`，
   * 并让 `test:e2e` 的 migrate → revert → migrate 往返继续成立。
   */
  public down(): Promise<void> {
    return Promise.resolve();
  }
}
