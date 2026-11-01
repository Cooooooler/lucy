import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 存量 `users.email` 归一的 SQL 表达式。空白集合必须与运行时
 * `normalizeEmail`（`String.prototype.trim().toLowerCase()`）对齐：
 * Postgres 的 `btrim` 单参数只去 ASCII 空格，`\s` 也只含 ASCII 空白，
 * NBSP（U+00A0）、全角空格（U+3000）等 Unicode 空白需要逐个列出。
 * `btrim` 的第二参数是字符集合，故这里直接枚举 JS trim 会剥掉的每个字符。
 */
const TRIM_CHARS =
  '\\t\\n\\r\\f\\u000B \\u00A0\\u1680' +
  '\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A' +
  '\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF';
const NORMALIZED_EMAIL = `btrim(lower("email"), E'${TRIM_CHARS}')`;

/**
 * 邮箱大小写不敏感：把存量 `users.email` 归一为小写并去掉首尾空白。
 *
 * 归一口径与运行时 `normalizeEmail` 一致，否则「库中值 = normalizeEmail(存量值)」
 * 不成立：绕过 DTO 写入的带首尾空白邮箱（`UsersService.create` 的归一正是为这类
 * 调用方准备的）会留在库里，此后登录（登录 DTO 会 trim）永远查不到，还能再注册
 * 一个近似重复的账号。
 *
 * 归一后，写入侧（注册 DTO / `UsersService.create`）只落小写、登录侧对含 `@` 的
 * account 也转小写再等值查询——「仅大小写不同的重复账号」与小写登录 401 一并消失。
 * 小写这一不变式另有实体上的 CHECK 约束（见 `User` 的 `@Check`）兜底。
 *
 * 但直接 UPDATE 可能撞 `users.email` 上的唯一约束（原本就存在归一后相同的两行）：
 * 此处先显式检测，命中则以 **清楚列出待合并账号** 的错误中止迁移（TypeORM 迁移在
 * 事务里，不会留下半归一状态），由人工决定保留哪个账号、如何迁移其关联数据后再重跑。
 *
 * 不额外建 `lower(email)` 函数索引：实体无法表达函数索引，下一次
 * `migration:generate` 会把它当成「元数据里没有的索引」删掉（实体是 schema 唯一来源）。
 */
export class NormalizeUserEmailCase1793491200000 implements MigrationInterface {
  name = 'NormalizeUserEmailCase1793491200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflicts = (await queryRunner.query(
      `SELECT ${NORMALIZED_EMAIL} AS "email", array_agg("username") AS "usernames", count(*) AS "count"
         FROM "users"
        GROUP BY ${NORMALIZED_EMAIL}
       HAVING count(*) > 1
        ORDER BY ${NORMALIZED_EMAIL}`,
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
      `UPDATE "users" SET "email" = ${NORMALIZED_EMAIL} WHERE "email" <> ${NORMALIZED_EMAIL}`,
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
