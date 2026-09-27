import { vi, type Mock } from 'vitest';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from '../knowledge/entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity.js';

/**
 * knowledge 模块测试的共享夹具：实体构造、QueryBuilder stub、游标/别名等。
 *
 * 抽出来的原因：`KnowledgeService` 与 `KnowledgeDocumentService` 两份 spec 需要同一套夹具
 * （实体形状、主别名与列名映射、like 聚合 QueryBuilder）。各写一份时，游标格式、主别名、
 * `findColumnWithPropertyName` 的列映射一旦调整就得同步改两处，容易只改一边而假绿。
 *
 * 本目录（`src/test/**`）在 vitest 覆盖率配置里被排除，夹具不计入覆盖率门禁。
 */

/** 实体主键是 uuid 列：游标里的 id 必须是合法 UUID，否则解码即 400 */
export const KB_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const DOC_ID = '1b6f4a2c-3d5e-4f70-8a91-b2c3d4e5f607';
/** 第二页游标里用的另一个合法 UUID */
export const OTHER_ID = '2c7a5b3d-4e6f-4081-9ba2-c3d4e5f60718';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

export const makeKb = (over = {}): KnowledgeBase => ({
  id: KB_ID,
  ownerId: 'u1',
  visibility: KnowledgeBaseVisibility.Private,
  name: '产品文档',
  description: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...over,
});

export const makeDoc = (over = {}): KnowledgeDocument => ({
  id: DOC_ID,
  knowledgeBaseId: 'kb1',
  fileId: 'f1',
  title: 'a',
  content: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...over,
});

/** `FileService.save` 的返回形状（存储后的文件描述） */
export const makeStored = (over = {}) => ({
  key: 'f1.pdf',
  ext: '.pdf',
  mime: 'application/pdf',
  size: 4,
  hash: 'abc',
  storage: 'local',
  ...over,
});

/**
 * 知识库对外契约视图（KnowledgeBaseItemDto）的字段集：服务层所有返回知识库的端点都必须是这个形状。
 * 按默认 `sort()` 的字典序**预排好**（不调用 `.sort()`：无比较函数的排序不可靠，Sonar 会判缺陷）。
 */
export const KB_ITEM_KEYS = [
  'createdAt',
  'description',
  'id',
  'isLiked',
  'likeCount',
  'name',
  'ownerId',
  'updatedAt',
  'visibility',
];

export const makeKbItem = (over = {}) => ({
  id: KB_ID,
  ownerId: 'u1',
  visibility: KnowledgeBaseVisibility.Private,
  name: '产品文档',
  description: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  likeCount: 0,
  isLiked: false,
  ...over,
});

/**
 * 主别名 + 实体元数据 stub：`KeysetPaginator` 从 QueryBuilder 自身解析别名与排序列名
 * （不再由调用方传 alias），故 mock 的 QueryBuilder 要提供 `expressionMap.mainAlias`；
 * 列名映射与实体上的 `name:` 一致。
 */
export const aliasStub = (name: string) => ({
  name,
  hasMetadata: true,
  metadata: {
    name: `${name}Entity`,
    findColumnWithPropertyName: (property: string) => ({
      databaseName: property === 'createdAt' ? 'created_at' : 'id',
    }),
  },
});

/** likeRepo 聚合查询用的 QueryBuilder stub 形状（显式标注，避免声明类型引用 vitest 内部的 Procedure） */
type LikeQb = {
  select: Mock;
  addSelect: Mock;
  where: Mock;
  andWhere: Mock;
  groupBy: Mock;
  getRawMany: Mock;
};

/** 可链式 QueryBuilder mock：供 likeRepo 的聚合查询用（getRawMany） */
export const makeLikeQb = (): LikeQb => {
  const qb = {
    select: vi.fn(),
    addSelect: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    groupBy: vi.fn(),
    getRawMany: vi.fn(),
  };
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.groupBy.mockReturnValue(qb);
  qb.getRawMany.mockResolvedValue([]);
  return qb;
};

/** 知识库列表用的 QueryBuilder stub 形状 */
type KbQb = {
  expressionMap: { mainAlias: ReturnType<typeof aliasStub> };
  where: Mock;
  orWhere: Mock;
  andWhere: Mock;
  orderBy: Mock;
  addOrderBy: Mock;
  take: Mock;
  getMany: Mock;
};

/** 可链式 QueryBuilder mock：记录 where/andWhere 等调用参数，供知识库 list 用（kbRepo） */
export const makeKbQb = (): KbQb => {
  const qb = {
    expressionMap: { mainAlias: aliasStub('kb') },
    where: vi.fn(),
    orWhere: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    take: vi.fn(),
    getMany: vi.fn(),
  };
  qb.where.mockReturnValue(qb);
  qb.orWhere.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);
  qb.getMany.mockResolvedValue([makeKb()]);
  return qb;
};

/** 文档列表用的 QueryBuilder stub 形状 */
type DocQb = {
  expressionMap: { mainAlias: ReturnType<typeof aliasStub> };
  select: Mock;
  where: Mock;
  andWhere: Mock;
  orderBy: Mock;
  addOrderBy: Mock;
  take: Mock;
  getMany: Mock;
};

/** 可链式 QueryBuilder mock：供文档 list 用（docRepo） */
export const makeDocQb = (): DocQb => {
  const qb = {
    expressionMap: { mainAlias: aliasStub('d') },
    select: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    take: vi.fn(),
    getMany: vi.fn(),
  };
  qb.select.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);
  qb.getMany.mockResolvedValue([makeDoc()]);
  return qb;
};

/** 拼接 query builder 上记录到的 SQL 片段，用于断言整体性质（如「不再含 date_trunc」） */
export const sqlOf = (...fns: { mock: { calls: unknown[][] } }[]) =>
  fns
    .flatMap((fn) => fn.mock.calls)
    .flat()
    .filter((arg): arg is string => typeof arg === 'string')
    .join(' ');

/** 生成第 i 个合法 UUID（仅供断言使用，不要求真实版本位） */
export const uuid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
