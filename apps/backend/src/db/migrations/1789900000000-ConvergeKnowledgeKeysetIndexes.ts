import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  createIndexSql,
  dropIndexSql,
  KEYSET_INDEXES,
  type KeysetIndexSpec,
} from '../keyset-indexes.js';

/** 索引在库里的实际形态（探测结果） */
interface IndexState {
  table: string;
  isValid: boolean;
  /** 键列顺序 */
  columns: string[];
  /** 与 `columns` 一一对应：该列是否降序 */
  descending: boolean[];
}

/**
 * 给**存量库**补齐三条 keyset 索引——专治「新库有、旧库没有」的漂移。
 *
 * 为什么需要它：迁移历史压缩后，`InitSchema.up()` 在存量库上只做 baseline（探测到 schema
 * 已存在就跳过整段 DDL），后续那条收敛迁移又只删不建。于是「只跑到某条旧迁移为止」的库
 * （备份恢复、跳过过某次发布的库）会缺这三条索引，而 `synchronize: false` 不会补——
 * 缺失时 `visibility = 'public'` / `owner_id` 两个过滤分支在游标分页下没有可用索引，
 * 默认分支还要在全量匹配集上排序后才 `LIMIT`，新分页的性能设计只对空库成立。
 *
 * 两条与「正常环境是空转」相关的保证：
 * 1. 索引形态按 `src/db/keyset-indexes.ts` 的规范逐列核对（列序 + `DESC`），不是只查
 *    存在性。`CREATE INDEX IF NOT EXISTS` 对**同名但形态不符**的索引会静默跳过
 *    （历史上 `IDX_knowledge_documents_kb_created` 就是这么被 ASC 版本取代的），
 *    那样迁移记成功而 keyset 依旧拿不到有序扫描；这里改为先 `DROP` 再重建。
 * 2. `down()` 是刻意的空操作，理由见方法注释。
 *
 * 事务：`transaction = false`（裸跑），两条独立理由，都不可省：
 * - `CREATE/DROP INDEX CONCURRENTLY` 不能在事务块中执行；
 * - 非 CONCURRENTLY 的 `CREATE INDEX` 会持 `SHARE` 锁直到事务提交，本迁移的目标恰是
 *   规模不受控的存量库，包进事务就是一次部署级写阻塞。
 * 白名单登记见 `src/db/migrations.spec.ts` 的 `BARE_RUN_MIGRATIONS`。
 */
export class ConvergeKnowledgeKeysetIndexes1789900000000 implements MigrationInterface {
  name = 'ConvergeKnowledgeKeysetIndexes1789900000000';

  /** 裸跑：CONCURRENTLY 不能进事务，且不能把建索引的锁持到提交（理由见类注释）。 */
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const spec of KEYSET_INDEXES) {
      const existing = await this.describe(queryRunner, spec.name);
      if (existing && this.matches(existing, spec)) {
        continue;
      }
      if (existing) {
        // 形态不符（缺列、列序不同、DESC 被换成 ASC）或上次 CONCURRENTLY 失败的 INVALID
        // 残留：两者都让 IF NOT EXISTS 静默跳过，因此先删再建
        await queryRunner.query(dropIndexSql(spec, true));
      }
      await queryRunner.query(createIndexSql(spec, true));
    }

    const mismatched = await this.findMismatched(queryRunner);
    if (mismatched.length > 0) {
      throw new Error(
        `keyset 索引未收敛到声明形态（存在但 INVALID / 列或方向不符 / 不存在）：${mismatched.join('；')}`,
      );
    }
  }

  /**
   * 刻意的空操作，不是遗漏——**不要**改成「存量库就删」。
   *
   * 本迁移只做「补齐到 InitSchema 声明的结构」，而 up() 是否真的建过索引取决于该库原本
   * 缺不缺：一个跑完旧 16 条迁移的存量库（`migrations` 表里同样有更早的记录）本来就带着
   * 这三条索引，up() 是空转。用「存在更早的迁移记录」当判据去 DROP，会在那类库上删掉
   * **不是本迁移建的**索引与默认值——一次 `db:revert` 把库退到比迁移前更差的状态，
   * 而 e2e 只在全新库上往返，永远发现不了。
   *
   * 要回退整库请用 `InitSchema.down()`（它在全新库上才会真正拆库）。空操作本身由
   * `init-schema.migration.spec.ts` 的用例钉住，防止后续维护者当成遗漏改坏。
   */
  public async down(): Promise<void> {
    // 见方法注释
  }

  /**
   * 读取索引的**实际**形态；不存在返回 null。
   *
   * 从系统目录取（而不是 `pg_get_indexdef(indexrelid, n, pretty)`）：后者的第 n 列形式只返回
   * **表达式**，`DESC` 被整条丢掉（实测 `created_at DESC` 只回 `created_at`），拿它比对
   * 会把 ASC 与 DESC 判成同一个索引。`indoption` 是每个键列的排序选项位图，bit 0 = DESC。
   *
   * 必须限定 `current_schema()` 与 `relkind = 'i'`：索引名在**每个 schema 内**唯一，但别的
   * schema 可以有同名索引；不限定就会取到多行，`rows[0]` 是哪一行不确定——若恰好取到形态
   * 相符的那一行，`up()` 会跳过真正该做的重建，收尾校验还会报「已收敛」。
   */
  private async describe(
    queryRunner: QueryRunner,
    name: string,
  ): Promise<IndexState | null> {
    const rows = (await queryRunner.query(
      `SELECT t.relname AS "table",
              i.indisvalid AS "isValid",
              json_agg(a.attname ORDER BY k) AS "columns",
              json_agg((i.indoption[k - 1] & 1) = 1 ORDER BY k) AS "descending"
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class t ON t.oid = i.indrelid
         CROSS JOIN generate_series(1, i.indnkeyatts) AS k
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[k - 1]
        WHERE c.relname = $1
          AND c.relkind = 'i'
          AND n.nspname = current_schema()
        GROUP BY t.relname, i.indisvalid`,
      [name],
    )) as IndexState[];
    return rows[0] ?? null;
  }

  /** 形态是否已是目标：同表、有效、列序与方向逐列一致 */
  private matches(state: IndexState, spec: KeysetIndexSpec): boolean {
    return (
      state.isValid &&
      state.table === spec.table &&
      state.columns.length === spec.columns.length &&
      state.columns.every(
        (column, index) => column === spec.columns[index].name,
      ) &&
      state.descending.every(
        (desc, index) => desc === (spec.columns[index].desc === true),
      )
    );
  }

  /** 把实际形态渲染成与规范定义同形的文本，便于日志里直接看出差在哪一列 */
  private render(state: IndexState): string {
    const columns = state.columns
      .map((column, index) =>
        state.descending[index] ? `${column} DESC` : column,
      )
      .join(', ');
    return `${state.isValid ? '' : 'INVALID '}${state.table}(${columns})`;
  }

  /** 收尾校验：逐条给出「实际是什么」，便于日志里直接定位 */
  private async findMismatched(queryRunner: QueryRunner): Promise<string[]> {
    const mismatched: string[] = [];
    for (const spec of KEYSET_INDEXES) {
      const state = await this.describe(queryRunner, spec.name);
      if (state && this.matches(state, spec)) {
        continue;
      }
      mismatched.push(
        `${spec.name} 实际：${state ? this.render(state) : '不存在'}`,
      );
    }
    return mismatched;
  }
}
