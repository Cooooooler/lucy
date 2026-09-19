import { Injectable } from '@nestjs/common';
import type { EntityMetadata, SelectQueryBuilder } from 'typeorm';
import { decodeCursor, encodeCursor, type CursorSortKey } from './cursor.js';
import { resolvePageSize } from './page-params.js';

/** 参与列名解析的属性：排序键加上用于决胜的 `id` */
type ResolvableProperty = CursorSortKey | 'id';

/** 解析排序键属性对应的真实列名；缺失说明该实体不满足游标分页契约，按装配错误直接抛出 */
function resolveSortColumn(
  metadata: EntityMetadata,
  property: ResolvableProperty,
): string {
  const column = metadata.findColumnWithPropertyName(property);
  if (!column) {
    throw new Error(
      `KeysetPaginator: 实体 ${metadata.name} 缺少 ${property} 列，无法用于游标分页`,
    );
  }
  return column.databaseName;
}

/**
 * keyset（游标）分页的通用装配：排序 → 游标谓词 → 多取一条 → 裁剪 + 生成下一页游标。
 *
 * 单独成 provider 的原因：它与实体、授权、文件存储都无关，是纯粹的查询装配——
 * 放在业务服务里会让那个服务继续膨胀，也无法被其它模块的列表复用（知识库列表、文档列表、
 * ai 会话列表都走这里）。
 * 由 `PaginationModule` 提供：需要复用的模块 `imports` 该模块即可，不必把无关特性耦进来。
 *
 * 语义要点（各列表共用同一份实现，排序键可指定）：
 * - 默认取实体的 `createdAt` 属性（不可变）：偏移分页下用可变排序键会让被更新的行越过
 *   游标、在后续页被永久漏掉；游标分页不受「窗口滑动」影响，但只有**单调递增**的可变键
 *   才可接受 —— 行只会移到已取过的方向，不会重复；代价是本轮翻页期间被更新的行会
 *   **被跳过**（它已移到游标之前），需刷新或重拉首页才能看到。会话列表按最近活跃排序
 *   （每次发消息刷新 `updatedAt`）正是这种情况，故可显式传入 `updatedAt`；
 * - 排序键**随游标一起编码**（`cursor.ts` 的 `k`）并在解码时校验：知识库/文档的
 *   `created_at` 游标不能拿到会话列表（`updated_at`）用，否则会拿错列做行比较而静默出错；
 * - 并列（同一毫秒、或同一事务批量插入）由 `id` 决胜，排序仍是全序；
 * - 谓词写成行比较 `(排序键, id) < (:cursorTs, :cursorId)`，Postgres 可优化成一次索引扫描
 *   （列顺序与实体上声明的 keyset 索引一致）；
 * - 多取一条判断是否还有下一页，避免额外的 COUNT。
 */
@Injectable()
export class KeysetPaginator {
  /**
   * 取一页（keyset）。
   * 约定：调用方需已用 `where()` 设好过滤条件（本方法只追加排序与游标谓词）。
   *
   * 别名与排序列名一律从 `qb` 自身解析，不由调用方再传一份：多一份真值就会在写错时
   * 静默拼出不存在的列（运行期 500）。
   *
   * 类型上用重载表达「**只要求排序键那一列**」：不传 `sortKey` 时只要求 `createdAt`，
   * 传 `updatedAt` 时只要求 `updatedAt` —— 只按 `createdAt` 分页的实体不必为了满足类型而
   * 带上永不被读取的 `updatedAt`（用类型参数 + `Record<K, Date>` 做不到：省略实参时 `K`
   * 会回退到约束 `'createdAt' | 'updatedAt'`，两列又被同时要求）。
   * @param qb 已带过滤条件的查询构造器
   * @param cursor 上一页返回的游标；省略表示首页。游标里带着它签出时的排序键，与本次
   *   `sortKey` 不一致（含缺少该字段的旧游标）会在解码处 400
   * @param limit 每页条数；经 `resolvePageSize` 归一化到 `[1, MAX_PAGE_SIZE]`（省略/非数值取默认值）
   * @param sortKey 排序键属性名，默认 `createdAt`（不可变）；按最近活跃排序的列表传 `updatedAt`
   * @returns 本页记录与下一页游标（null 表示已到末页）
   */
  async fetchPage<T extends { id: string; createdAt: Date }>(
    qb: SelectQueryBuilder<T>,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<{ list: T[]; nextCursor: string | null }>;
  async fetchPage<T extends { id: string }, K extends CursorSortKey>(
    qb: SelectQueryBuilder<T & Record<K, Date>>,
    cursor: string | undefined,
    limit: number | undefined,
    sortKey: K,
  ): Promise<{ list: (T & Record<K, Date>)[]; nextCursor: string | null }>;
  async fetchPage(
    qb: SelectQueryBuilder<{ id: string }>,
    cursor: string | undefined,
    limit: number | undefined,
    sortKey: CursorSortKey = 'createdAt',
  ): Promise<{ list: { id: string }[]; nextCursor: string | null }> {
    const mainAlias = qb.expressionMap.mainAlias;
    if (!mainAlias?.hasMetadata) {
      throw new Error(
        'KeysetPaginator: QueryBuilder 的主别名没有实体元数据，无法用于游标分页',
      );
    }
    const sortColumn = `${mainAlias.name}.${resolveSortColumn(mainAlias.metadata, sortKey)}`;
    const id = `${mainAlias.name}.${resolveSortColumn(mainAlias.metadata, 'id')}`;
    // 入口守卫：DTO 的 `@Min`/`@Max`/`@IsInt` 只作用于 HTTP 入参路径，本方法收的是结构化
    // 类型，内部复用方（会话/消息列表、拼接上下文）能直接给 limit——上界不挡是 take(N+1)
    // 大扫描，下界与非数值不挡则拼出 `LIMIT 2.5`/负 LIMIT。归一化策略与页码分页共用一处实现
    const size = resolvePageSize(limit);
    qb.orderBy(sortColumn, 'DESC').addOrderBy(id, 'DESC');
    if (cursor) {
      // 带上本次的排序键：签出时用的列与当前列不一致就 400，不拿错列做行比较
      const { timestamp, id: cursorId } = decodeCursor(cursor, sortKey);
      qb.andWhere(`(${sortColumn}, ${id}) < (:cursorTs, :cursorId)`, {
        cursorTs: timestamp,
        cursorId,
      });
    }
    const rows = await qb.take(size + 1).getMany();
    // 实现签名只认 `{ id }`，排序键那一列的存在性由上面的重载对调用方保证（运行期另有
    // `resolveSortColumn` 兜底），故这里按排序键读出时间戳需要断言
    return this.toCursorPage(rows, size, (row) =>
      encodeCursor(
        (row as unknown as Record<CursorSortKey, Date>)[sortKey],
        row.id,
        sortKey,
      ),
    );
  }

  /**
   * 把「多取一条」的查询结果裁成首页大小，并生成下一页游标。
   * 多取一条用于判断是否还有下一页，避免额外的 COUNT 查询。
   */
  private toCursorPage<T>(
    rows: T[],
    limit: number,
    toCursor: (row: T) => string,
  ): { list: T[]; nextCursor: string | null } {
    const hasNext = rows.length > limit;
    const list = hasNext ? rows.slice(0, limit) : rows;
    const last = list.at(-1);
    const nextCursor = hasNext && last ? toCursor(last) : null;
    return { list, nextCursor };
  }
}
