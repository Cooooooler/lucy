import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把**存量库**两个知识库表的时间列默认值收敛到毫秒对齐——与
 * `ConvergeKnowledgeKeysetIndexes1789900000000` 同一个成因（初始化迁移在存量库上只做
 * baseline，跳过整段 DDL），只是这里补的是列默认值。
 *
 * 为什么必须是毫秒：keyset 游标是毫秒精度（JS Date 的固有精度），列默认值若还是微秒精度的
 * `now()`，同一毫秒内插入的多行会带着微秒尾巴，`(created_at, id) < (:cursorTs, :cursorId)`
 * 会把整批行一起跳过。
 *
 * 与索引迁移**拆成两条**的原因：这四条 `ALTER TABLE ... SET DEFAULT` 要 `ACCESS EXCLUSIVE`
 * 锁，但每条都是毫秒级、天然的幂等语句，包在一个短事务里是正确的（要么全成、要么全回滚）；
 * 而建索引必须裸跑。合成一条时，裸跑会让这四条失去原子性，包事务又会让建索引的锁持到提交。
 *
 * `down()` 是刻意的空操作，理由与索引迁移相同：up() 是否真的改过默认值取决于该库原本是
 * 不是 `now()`（跑完旧迁移链的存量库本来就已是毫秒对齐，up() 是空转），无法在 down() 时
 * 分辨，删/改回去会把「不是本迁移建的」库退到比迁移前更差的状态。
 */
export class ConvergeKnowledgeMillisDefaults1789910000000 implements MigrationInterface {
  name = 'ConvergeKnowledgeMillisDefaults1789910000000';

  /** 需要毫秒对齐默认值的时间列（表 → 列） */
  static readonly COLUMNS = [
    ['knowledge_bases', 'created_at'],
    ['knowledge_bases', 'updated_at'],
    ['knowledge_documents', 'created_at'],
    ['knowledge_documents', 'updated_at'],
  ] as const;

  /** 显式原子化：四条 SET DEFAULT 要么全成、要么全回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      table,
      column,
    ] of ConvergeKnowledgeMillisDefaults1789910000000.COLUMNS) {
      // SET DEFAULT 天然幂等：对已对齐的列重复执行是空转
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT date_trunc('milliseconds', now())`,
      );
    }
  }

  /** 刻意的空操作（理由见类注释）；由 init-schema.migration.spec.ts 的用例钉住。 */
  public async down(): Promise<void> {
    // 见类注释
  }
}
