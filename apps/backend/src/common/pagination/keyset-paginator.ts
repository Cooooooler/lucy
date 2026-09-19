import { Injectable } from '@nestjs/common';
import type { EntityMetadata, SelectQueryBuilder } from 'typeorm';
import { decodeCursor, encodeCursor } from './cursor.js';
import { resolvePageSize } from './page-params.js';

/**
 * keyset 分页要求的排序键**属性名**（不是列名）。
 * 真实列名由实体元数据解析（见 {@link resolveSortColumn}），而不是写死 `created_at` / `id`：
 * 泛型约束只能保证实体「有这两个属性」，换个 `name` 映射（或换掉 snake_case 命名策略）
 * 照样编译通过，写死列名就会在运行期报列不存在（500），列存在时也可能对不上迁移里
 * 建的 `(created_at DESC, id DESC)` keyset 索引，退化成排序扫描。
 */
type SortKeyProperty = 'createdAt' | 'id';

/** 解析排序键属性对应的真实列名；缺失说明该实体不满足游标分页契约，按装配错误直接抛出 */
function resolveSortColumn(
  metadata: EntityMetadata,
  property: SortKeyProperty,
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
 * 放在业务服务里会让那个服务继续膨胀（它已经背着知识库 CRUD、文档 CRUD + 文件清理、点赞聚合），
 * 也无法被其它模块的列表复用（如 ai 模块的会话/消息列表）。
 * 由 `PaginationModule` 提供：需要复用的模块 `imports` 该模块即可，不必把无关特性耦进来。
 *
 * 语义要点（知识库列表与文档列表必须完全一致，所以只有这一份实现）：
 * - 排序键取实体的 `createdAt` 属性（列 `created_at`），**不用可变的 `updatedAt`**：
 *   上页取出后被更新的行会越过游标，在后续页被永久漏掉；
 * - 并列（同一毫秒、或同一事务批量插入）由 `id` 决胜，排序仍是全序；
 * - 谓词写成行比较 `(created_at, id) < (:cursorTs, :cursorId)`，Postgres 可优化成一次索引扫描
 *   （列顺序与 `created_at DESC, id DESC` 的 keyset 索引一致）；
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
   * @param qb 已带过滤条件的查询构造器
   * @param cursor 上一页返回的游标；省略表示首页
   * @param limit 每页条数；经 `resolvePageSize` 归一化到 `[1, MAX_PAGE_SIZE]`（省略/非数值取默认值）
   * @returns 本页记录与下一页游标（null 表示已到末页）
   */
  async fetchPage<T extends { createdAt: Date; id: string }>(
    qb: SelectQueryBuilder<T>,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<{ list: T[]; nextCursor: string | null }> {
    const mainAlias = qb.expressionMap.mainAlias;
    if (!mainAlias?.hasMetadata) {
      throw new Error(
        'KeysetPaginator: QueryBuilder 的主别名没有实体元数据，无法用于游标分页',
      );
    }
    const createdAt = `${mainAlias.name}.${resolveSortColumn(mainAlias.metadata, 'createdAt')}`;
    const id = `${mainAlias.name}.${resolveSortColumn(mainAlias.metadata, 'id')}`;
    // 入口守卫：DTO 的 `@Min`/`@Max`/`@IsInt` 只作用于 HTTP 入参路径，本方法收的是结构化
    // 类型，内部复用方（会话/消息列表、拼接上下文）能直接给 limit——上界不挡是 take(N+1)
    // 大扫描，下界与非数值不挡则拼出 `LIMIT 2.5`/负 LIMIT。归一化策略与页码分页共用一处实现
    const size = resolvePageSize(limit);
    qb.orderBy(createdAt, 'DESC').addOrderBy(id, 'DESC');
    if (cursor) {
      const { timestamp, id: cursorId } = decodeCursor(cursor);
      qb.andWhere(`(${createdAt}, ${id}) < (:cursorTs, :cursorId)`, {
        cursorTs: timestamp,
        cursorId,
      });
    }
    const rows = await qb.take(size + 1).getMany();
    return this.toCursorPage(rows, size, (row) =>
      encodeCursor(row.createdAt, row.id),
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
