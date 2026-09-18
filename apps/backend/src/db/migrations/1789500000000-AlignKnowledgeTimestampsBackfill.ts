import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 游标分页（keyset）按不可变的 `(created_at, id)` 降序排序，游标精度是毫秒
 * （JS Date 固有精度）。若库里存在微秒时间戳——手写 SQL 的 seed 用默认值 `now()`
 * 就会产生——同一毫秒内、微秒更大的行会同时不满足 `<` 与 `=`，被整批跳过。
 *
 * 本迁移负责「时间戳毫秒对齐」这一半，且刻意与索引拆分（见后续
 * AddKnowledgeKeysetIndexes 迁移），避免把全表 UPDATE 与建索引塞进同一个事务：
 *
 * - `transaction = false`：TypeORM 不再包一个整体事务，每条语句各自提交，
 *   于是下面「默认值 + 分批回填」的每一批都是一个独立的短事务，
 *   不会长时间持锁、也不会一次性产生巨量 WAL/bloat。
 * - 默认值改成毫秒对齐，保证今后任何手写 INSERT（不经过 TypeORM）也不再引入微秒。
 * - 历史数据按主键分批回填（每批 BATCH_SIZE 行），循环到没有行被更新为止。
 *   回填幂等：毫秒对齐后重复执行匹配 0 行、直接空转。
 *
 * 数据取整不可逆（原始微秒值已丢失），故 `down` 只还原默认值、不还原数据。
 */
export class AlignKnowledgeTimestampsBackfill1789500000000 implements MigrationInterface {
  name = 'AlignKnowledgeTimestampsBackfill1789500000000';

  /**
   * 按语句自动提交：每批回填 = 一个短事务，避免旧实现里「全表 UPDATE 单事务」的长锁。
   * @see https://typeorm.io/migrations#transactions
   */
  transaction = false;

  /** 每批回填的行数：单批走主键索引，锁范围小、提交快。 */
  private static readonly BATCH_SIZE = 1000;

  private static readonly TABLES = [
    'knowledge_bases',
    'knowledge_documents',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 默认值毫秒对齐（元数据操作，很快；今后手写 SQL 也只会写入毫秒精度）
    for (const table of AlignKnowledgeTimestampsBackfill1789500000000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "created_at" SET DEFAULT date_trunc('milliseconds', now())`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updated_at" SET DEFAULT date_trunc('milliseconds', now())`,
      );
    }

    // 2) 历史数据分批回填：每轮只锁定并更新一批（两列一并处理，保持两列一致）
    for (const table of AlignKnowledgeTimestampsBackfill1789500000000.TABLES) {
      await this.backfillTable(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 默认值改回 now()；时间戳的具体取整不可逆（原始微秒值已丢失），故不还原数据。
    for (const table of AlignKnowledgeTimestampsBackfill1789500000000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "created_at" SET DEFAULT now()`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updated_at" SET DEFAULT now()`,
      );
    }
  }

  /**
   * 按主键游标分批把两列取整到毫秒，直到某批取不到行。
   *
   * 用 `"id" > lastId ORDER BY "id" LIMIT n` 推进游标：每批只从上次位置之后取行，
   * 已处理过的行不再被回看，整体 O(n)。若只写「两列任一未对齐」+ `LIMIT`，
   * 每轮都要顺序扫过越来越多「已对齐」的行才能凑够一批，总体约 O(n²/批大小)，
   * 收敛判定那一轮更是一次全表扫描。
   *
   * 更新仍按两列一起做（保持 created_at/updated_at 一致）；对齐后不再满足条件，
   * 因此重复执行匹配 0 行、直接空转（幂等）。
   */
  private async backfillTable(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    const batchSize = AlignKnowledgeTimestampsBackfill1789500000000.BATCH_SIZE;
    let lastId: string | null = null;
    for (;;) {
      const batch = (await queryRunner.query(
        `SELECT "id" FROM "${table}"
          WHERE ("created_at" <> date_trunc('milliseconds', "created_at")
              OR "updated_at" <> date_trunc('milliseconds', "updated_at"))
            AND ($1::uuid IS NULL OR "id" > $1::uuid)
          ORDER BY "id"
          LIMIT ${batchSize}`,
        [lastId],
      )) as { id: string }[];
      if (batch.length === 0) return;

      await queryRunner.query(
        `UPDATE "${table}" SET
           "created_at" = date_trunc('milliseconds', "created_at"),
           "updated_at" = date_trunc('milliseconds', "updated_at")
         WHERE "id" = ANY($1::uuid[])`,
        [batch.map((row) => row.id)],
      );
      lastId = batch[batch.length - 1].id;
    }
  }
}
