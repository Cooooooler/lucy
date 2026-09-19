import { Injectable } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';
import { decodeCursor, encodeCursor } from './cursor.js';

/** 游标分页默认每页条数 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * keyset（游标）分页的通用装配：排序 → 游标谓词 → 多取一条 → 裁剪 + 生成下一页游标。
 *
 * 单独成 provider 的原因：它与实体、授权、文件存储都无关，是纯粹的查询装配——
 * 放在业务服务里会让那个服务继续膨胀（它已经背着知识库 CRUD、文档 CRUD + 文件清理、点赞聚合），
 * 也无法被其它模块的列表复用（如 ai 模块的会话/消息列表）。
 *
 * 语义要点（知识库列表与文档列表必须完全一致，所以只有这一份实现）：
 * - 排序键是**不可变**的 `created_at`（不用可变的 `updated_at`：上页取出后被更新的行会越过游标，
 *   在后续页被永久漏掉）；
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
   * @param qb 已带过滤条件的查询构造器
   * @param alias 实体别名（排序列名前缀）
   * @param cursor 上一页返回的游标；省略表示首页
   * @param limit 每页条数；省略取 DEFAULT_PAGE_SIZE
   * @returns 本页记录与下一页游标（null 表示已到末页）
   */
  async fetchPage<T extends { createdAt: Date; id: string }>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<{ list: T[]; nextCursor: string | null }> {
    const size = limit ?? DEFAULT_PAGE_SIZE;
    qb.orderBy(`${alias}.created_at`, 'DESC').addOrderBy(`${alias}.id`, 'DESC');
    if (cursor) {
      const { timestamp, id } = decodeCursor(cursor);
      qb.andWhere(
        `(${alias}.created_at, ${alias}.id) < (:cursorTs, :cursorId)`,
        { cursorTs: timestamp, cursorId: id },
      );
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
