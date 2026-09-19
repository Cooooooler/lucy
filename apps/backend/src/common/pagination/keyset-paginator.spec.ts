import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCursor } from './cursor.js';
import { KeysetPaginator } from './keyset-paginator.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.constants.js';

/**
 * KeysetPaginator 的单测：装配语义（排序键、多取一条、游标谓词）此前只通过 KnowledgeService
 * 的调用间接触发，这里直接钉住它自己的契约。
 */
type Row = { id: string; createdAt: Date };

type SortKey = 'createdAt' | 'id';

const row = (index: number): Row => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)),
});

/**
 * 主别名 + 实体元数据 stub：只实现 KeysetPaginator 用到的能力（`hasMetadata` 与
 * 属性名 → 列名）。列名默认与实体的 `name:` 映射一致，可用 `columns` 模拟改过列名
 * 或换过命名策略的实体。
 */
function makeAlias(
  name: string,
  columns: Partial<Record<SortKey, string>> = {},
) {
  const mapping: Record<SortKey, string> = {
    createdAt: 'created_at',
    id: 'id',
    ...columns,
  };
  return {
    name,
    hasMetadata: true,
    metadata: {
      name: `${name}Entity`,
      findColumnWithPropertyName: (property: string) =>
        property in mapping
          ? { databaseName: mapping[property as SortKey] }
          : undefined,
    },
  };
}

/** 可链式 QueryBuilder stub：记录调用、返回预置行（`as never` 传参，与 service spec 一致） */
function makeQueryBuilder(rows: Row[], alias = makeAlias('kb')) {
  const qb = {
    expressionMap: { mainAlias: alias },
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    andWhere: vi.fn(),
    take: vi.fn(),
    getMany: vi.fn().mockResolvedValue(rows),
  };
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);
  return qb;
}

describe('KeysetPaginator', () => {
  const paginator = new KeysetPaginator();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按不可变的 created_at 降序 + id 决胜排序，并多取一条（默认 20 → take(21)）', async () => {
    const qb = makeQueryBuilder([row(1)]);

    await paginator.fetchPage(qb as never, undefined, undefined);

    expect(qb.orderBy).toHaveBeenCalledWith('kb.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('kb.id', 'DESC');
    expect(qb.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE + 1);
    // 首页不追加游标谓词
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('别名与列名都取自 QueryBuilder 与实体元数据（不额外传参，也不写死列名）', async () => {
    const qb = makeQueryBuilder(
      [row(1)],
      makeAlias('x', { createdAt: 'created_on' }),
    );

    await paginator.fetchPage(qb as never, undefined, undefined);

    expect(qb.orderBy).toHaveBeenCalledWith('x.created_on', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('x.id', 'DESC');
  });

  it('limit 超过上限时按 MAX_PAGE_SIZE 钳制（@Max 只管 HTTP 入参，复用方绕过它）', async () => {
    const qb = makeQueryBuilder([]);

    await paginator.fetchPage(qb as never, undefined, 10 ** 9);

    expect(qb.take).toHaveBeenCalledWith(MAX_PAGE_SIZE + 1);
  });

  it('带游标时追加行比较谓词（解码后按原始列比较）', async () => {
    const qb = makeQueryBuilder([row(2)], makeAlias('d'));
    const cursor = encodeCursor(row(5).createdAt, row(5).id);

    await paginator.fetchPage(qb as never, cursor, 3);

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.created_at, d.id) < (:cursorTs, :cursorId)',
      { cursorTs: row(5).createdAt, cursorId: row(5).id },
    );
    expect(qb.take).toHaveBeenCalledWith(4);
  });

  it('多取到一条时裁到 limit，并用最后一条生成下一页游标', async () => {
    const rows = [row(1), row(2), row(3)];
    const qb = makeQueryBuilder(rows);

    const page = await paginator.fetchPage(qb as never, undefined, 2);

    expect(page.list).toEqual([row(1), row(2)]);
    expect(page.nextCursor).toBe(encodeCursor(row(2).createdAt, row(2).id));
  });

  it('结果不多于 limit 时 nextCursor 为 null（末页）', async () => {
    const qb = makeQueryBuilder([row(1), row(2)]);

    const page = await paginator.fetchPage(qb as never, undefined, 5);

    expect(page.list).toEqual([row(1), row(2)]);
    expect(page.nextCursor).toBeNull();
  });

  it('空结果返回空列表与 null 游标', async () => {
    const qb = makeQueryBuilder([]);

    const page = await paginator.fetchPage(qb as never, undefined, 5);

    expect(page).toEqual({ list: [], nextCursor: null });
  });

  it('非法游标在解码入口就抛 400（不把非法输入带进 SQL）', async () => {
    const qb = makeQueryBuilder([]);

    await expect(
      paginator.fetchPage(qb as never, 'not-a-cursor', 5),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 排序是内存里的 QueryBuilder 状态，无害；关键是没有任何查询真正发出去
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.getMany).not.toHaveBeenCalled();
  });

  it('实体缺排序键对应的列时直接抛错（不静默拼出不存在的列）', async () => {
    // 元数据解析不出属性对应的列：泛型约束过了（有 createdAt 属性），但列映射不存在
    const qb = makeQueryBuilder([], {
      name: 'kb',
      hasMetadata: true,
      metadata: {
        name: 'LegacyEntity',
        findColumnWithPropertyName: () => undefined,
      },
    });

    await expect(
      paginator.fetchPage(qb as never, undefined, 5),
    ).rejects.toThrow('LegacyEntity');
    expect(qb.getMany).not.toHaveBeenCalled();
  });
});
