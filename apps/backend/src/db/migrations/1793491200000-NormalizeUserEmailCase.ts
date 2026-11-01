import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 邮箱大小写不敏感：把存量 `users.email` 归一为 `btrim(lower(email))`。
 *
 * 归一口径必须与运行时 `normalizeEmail`（`trim().toLowerCase()`）一致，否则
 * 「库中值 = normalizeEmail(存量值)」不成立：绕过 DTO 写入的带首尾空白邮箱
 * （`UsersService.create` 的归一正是为这类调用方准备的）会留在库里，此后登录
 * （登录 DTO 会 trim）永远查不到，还能再注册一个近似重复的账号。
 *
 * 归一后，写入侧（注册 DTO / `UsersService.create`）只落小写、登录侧对含 `@` 的 account
 * 也转小写再等值查询——「仅大小写不同的重复账号」与小写登录 401 一并消失。
 * 该不变式另有实体上的 CHECK 约束（见 `User` 的 `@Check`）兜底，直接 SQL 也绕不过去。
 *
 * 但直接 UPDATE 可能撞 `users.email` 上的唯一约束（原本就存在归一后相同的两行）：
 * 此处先显式检测，命中则以 **清楚列出待合并账号** 的错误中止迁移（TypeORM 迁移在事务里，
 * 不会留下半归一状态），由人工决定保留哪个账号、如何迁移其关联数据后再重跑。
 *
 * 不额外建 `lower(email)` 函数索引：实体无法表达函数索引，下一次 `migration:generate`
 * 会把它当成「元数据里没有的索引」删掉（实体是 schema 唯一来源，见 AGENTS.md）。
 */
export class NormalizeUserEmailCase1793491200000 implements MigrationInterface {
  name = 'NormalizeUserEmailCase1793491200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflicts = (await queryRunner.query(
      `SELECT btrim(lower("email")) AS "email", array_agg("username") AS "usernames", count(*) AS "count"
         FROM "users"
        GROUP BY btrim(lower("email"))
       HAVING count(*) > 1
        ORDER BY btrim(lower("email"))`,
    )) as { email: string; usernames: string[]; count: string }[];

    if (conflicts.length > 0) {
      const detail = conflicts
        .map(
          (row) =>
            `${row.email}（${row.count} 条：${row.usernames.join('、')}）`,
        )
        .join('；');
      throw new Error(
        `users.email 存在归一后相同的重复账号，请先人工合并保留项与关联数据，再执行迁移：${detail}`,
      );
    }

    await queryRunner.query(
      `UPDATE "users" SET "email" = btrim(lower("email")) WHERE "email" <> btrim(lower("email"))`,
    );
  }

  /**
   * 原始大小写/首尾空白不可恢复（未保留副本），故为 no-op：保留方法只为满足
   * `MigrationInterface`，并让 `test:e2e` 的 migrate → revert → migrate 往返继续成立。
   */
  public down(): Promise<void> {
    return Promise.resolve();
  }
}
