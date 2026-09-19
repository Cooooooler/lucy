import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeService } from './knowledge.service.js';

// ESM + SWC 下对 ES 导出命名空间 `vi.spyOn` 未必能拦截服务内部静态 import 绑定的同名导出
// （live-binding 不保证命中）；改用顶层 `vi.mock` 打桩 `detectFileType` / `extractContent`，
// 确保 addDocument 的魔数校验与解析分支、回滚真正落到生产逻辑上。
vi.mock('./magic-bytes.js', () => ({
  detectFileType: vi.fn(),
}));
vi.mock('./content-extractor.js', () => ({
  SUPPORTED_DOCUMENT_EXTS: ['.txt', '.md', '.pdf', '.docx'],
  extractContent: vi.fn(),
}));

import { extractContent } from './content-extractor.js';
import { detectFileType } from './magic-bytes.js';

/** 实体主键是 uuid 列：游标里的 id 必须是合法 UUID，否则解码即 400 */
const KB_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const DOC_ID = '1b6f4a2c-3d5e-4f70-8a91-b2c3d4e5f607';
/** 第二页游标里用的另一个合法 UUID */
const OTHER_ID = '2c7a5b3d-4e6f-4081-9ba2-c3d4e5f60718';

describe('KnowledgeService', () => {
  const kbRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
    find: vi.fn(),
  };
  const docRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
    find: vi.fn(),
  };
  const fileRepo = {
    findOneBy: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };
  const likeRepo = {
    findOneBy: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  // DataSource mock：transaction 调用回调并传入 manager
  const dataSource = {
    transaction: vi.fn((cb: (manager: unknown) => unknown) => {
      const manager = {
        getRepository: vi.fn((entity: unknown) => {
          if (entity === KnowledgeBase) return kbRepo;
          if (entity === KnowledgeDocument) return docRepo;
          return fileRepo;
        }),
      };
      return cb(manager);
    }),
  } as unknown as DataSource;
  const fileService = {
    save: vi.fn(),
    remove: vi.fn(),
  };
  const config = new ConfigService({ FILE_MAX_SIZE: 1024 });
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLogger;

  let service: KnowledgeService;

  // 可链式 QueryBuilder mock：供 likeRepo 用（getRawMany）
  const makeLikeQb = () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    // 点赞态回填（fillLikeInfo）被 get/list/update 共用：默认给一个空结果的可链式 stub，
    // 避免依赖「上个用例遗留的 mockReturnValue」——clearAllMocks 只清调用记录不清实现
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    service = new KnowledgeService(
      logger,
      dataSource,
      kbRepo as never,
      docRepo as never,
      likeRepo as never,
      fileService as never,
      config,
    );
  });

  const stored = (over = {}) =>
    Object.assign(
      {
        key: 'f1.pdf',
        ext: '.pdf',
        mime: 'application/pdf',
        size: 4,
        hash: 'abc',
        storage: 'local',
      },
      over,
    );

  const kb = (over = {}) =>
    Object.assign(new KnowledgeBase(), {
      id: KB_ID,
      ownerId: 'u1',
      visibility: KnowledgeBaseVisibility.Private,
      name: '产品文档',
      description: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...over,
    });
  const doc = (over = {}) =>
    Object.assign(new KnowledgeDocument(), {
      id: DOC_ID,
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      content: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...over,
    });

  /** 知识库对外契约视图（KnowledgeBaseItemDto）：服务层所有返回知识库的端点都必须是这个形状 */
  const KB_ITEM_KEYS = [
    'id',
    'ownerId',
    'visibility',
    'name',
    'description',
    'createdAt',
    'updatedAt',
    'likeCount',
    'isLiked',
  ].sort();

  const kbItem = (over = {}) => ({
    id: KB_ID,
    ownerId: 'u1',
    visibility: KnowledgeBaseVisibility.Private,
    name: '产品文档',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    likeCount: 0,
    isLiked: false,
    ...over,
  });

  // 可链式 QueryBuilder mock：记录 where/andWhere 等调用参数，供 list 用
  const makeKbQb = () => {
    const qb = {
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
    qb.getMany.mockResolvedValue([kb()]);
    return qb;
  };

  // 可链式 QueryBuilder mock：供 listDocuments 用（docRepo）
  const makeDocQb = () => {
    const qb = {
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
    qb.getMany.mockResolvedValue([doc()]);
    return qb;
  };

  /** 拼接 query builder 上记录到的 SQL 片段，用于断言整体性质（如「不再含 date_trunc」） */
  const sqlOf = (...fns: { mock: { calls: unknown[][] } }[]) =>
    fns
      .flatMap((fn) => fn.mock.calls)
      .flat()
      .filter((arg): arg is string => typeof arg === 'string')
      .join(' ');

  /** 生成第 i 个合法 UUID（仅供断言使用，不要求真实版本位） */
  const uuid = (i: number) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

  it('create 保存知识库（默认 private）并返回契约视图', async () => {
    kbRepo.save.mockResolvedValue(kb());
    const result = await service.create('u1', { name: 'x' });
    expect(result).toEqual(kbItem());
    // 契约项是普通视图对象，不携带实体上的内部关系（owner 等）
    expect(result).not.toBeInstanceOf(KnowledgeBase);
    expect(kbRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        name: 'x',
        visibility: 'private',
      }),
    );
  });

  it('get 属主可读，附带 likeCount/isLiked', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const result = await service.get('u1', 'kb1');
    expect(result).toEqual(kbItem());
    expect(result.likeCount).toBe(0);
    expect(result.isLiked).toBe(false);
  });

  it('get 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      kb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    await expect(service.get('u2', 'kb1')).resolves.toEqual(
      kbItem({ visibility: KnowledgeBaseVisibility.Public }),
    );
  });

  it('create/get/list/update 字段集完全一致（契约不随端点漂移）', async () => {
    kbRepo.save.mockResolvedValue(kb());
    const created = await service.create('u1', { name: 'x' });

    kbRepo.findOne.mockResolvedValue(kb());
    const detail = await service.get('u1', KB_ID);

    kbRepo.createQueryBuilder.mockReturnValue(makeKbQb());
    const listed = await service.list('u1', {});

    kbRepo.findOne.mockResolvedValue(kb());
    kbRepo.save.mockResolvedValue(kb());
    const updated = await service.update('u1', KB_ID, { name: 'y' });

    for (const [endpoint, item] of Object.entries({
      create: created,
      get: detail,
      list: listed.list[0],
      update: updated,
    })) {
      expect(Object.keys(item).sort(), `${endpoint} 的字段集不一致`).toEqual(
        KB_ITEM_KEYS,
      );
    }
  });

  it('update 回填点赞态（更新后仍与 get/list 同形，不谎报 0/false）', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    kbRepo.save.mockResolvedValue(kb());
    const likeQb = makeLikeQb();
    likeQb.getRawMany.mockResolvedValue([{ kbId: KB_ID, cnt: '3' }]);
    likeRepo.createQueryBuilder.mockReturnValue(likeQb);

    const result = await service.update('u1', KB_ID, { name: 'y' });

    expect(result.likeCount).toBe(3);
    expect(result.isLiked).toBe(true);
  });

  it('get 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.get('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { statusCode: 403 },
    });
  });

  it('update 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.update('u2', 'kb1', { name: 'y' }),
    ).rejects.toMatchObject({
      response: { statusCode: 403 },
    });
  });

  it('remove 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.remove('u2', 'kb1')).rejects.toMatchObject({
      response: { statusCode: 403 },
    });
  });

  it('addDocument 校验非法扩展名', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('x'),
        originalname: 'a.exe',
        size: 1,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 415 },
    });
  });

  it('addDocument 超出大小限制', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const big = Buffer.alloc(2048);
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: big,
        originalname: 'a.txt',
        size: big.length,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 413 },
    });
    expect(fileService.save).not.toHaveBeenCalled();
  });

  it('addDocument pdf 魔数不匹配拒收', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'png',
      mime: 'image/png',
    });
    fileService.save.mockResolvedValue({ id: 'f1' });
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('notpdf'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 415 },
    });
  });

  it('addDocument 解析失败回滚删除文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    fileService.save.mockResolvedValue(stored());
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    vi.mocked(extractContent).mockRejectedValue(new Error('parse fail'));
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 422 },
    });
    // 事务回滚后只需清理底层文件（数据库记录已自动回滚）
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
  });

  it('addDocument 正常上传并入库', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(stored());
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    docRepo.save.mockResolvedValue(doc({ content: '正文' }));
    const uploaded = await service.addDocument('u1', 'kb1', {
      buffer: Buffer.from('%PDF'),
      originalname: 'a.pdf',
      size: 4,
    } as never);
    // 上传返回详情契约视图（与 getDocument 同形，含 content），不是实体本身
    expect(uploaded).toEqual({
      id: DOC_ID,
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      content: '正文',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(fileService.save).toHaveBeenCalled();
    expect(fileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        originalName: 'a.pdf',
        ext: '.pdf',
        key: 'f1.pdf',
        storage: 'local',
      }),
    );
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a', content: '正文', fileId: 'f1' }),
    );
  });

  it('removeDocument 删文档并清文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileRepo.findOneBy.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.delete.mockResolvedValue({ affected: 1 });
    fileRepo.delete.mockResolvedValue({ affected: 1 });
    await service.removeDocument('u1', 'kb1', 'd1');
    expect(docRepo.delete).toHaveBeenCalledWith({
      id: 'd1',
      knowledgeBaseId: 'kb1',
    });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: 'f1' });
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
  });

  it('list 默认可见性：属主或公开库（括号包裹 OR），返回 list/nextCursor，附带 likeCount/isLiked', async () => {
    const qb = makeKbQb();
    qb.getMany.mockResolvedValue([kb()]);
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    const likeQb = makeLikeQb();
    likeRepo.createQueryBuilder.mockReturnValue(likeQb);
    const result = await service.list('u1', {});
    expect(qb.where).toHaveBeenCalledWith(
      '(kb.ownerId = :uid OR kb.visibility = :pub)',
      { uid: 'u1', pub: KnowledgeBaseVisibility.Public },
    );
    expect(qb.orWhere).not.toHaveBeenCalled();
    expect(qb.getMany).toHaveBeenCalled();
    // 多取一条判断是否有下一页
    expect(qb.take).toHaveBeenCalledWith(21);
    expect(result).toEqual({
      list: [kbItem()],
      nextCursor: null,
    });
    // 验证 like 回写
    expect(likeRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(result.list[0].likeCount).toBe(0);
    expect(result.list[0].isLiked).toBe(false);
  });

  it('list 排序键为不可变的 created_at 且直接用原始列（不再毫秒截断）', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    await service.list('u1', { cursor: encodeCursor(new Date(), uuid(9)) });
    expect(qb.orderBy).toHaveBeenCalledWith('kb.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('kb.id', 'DESC');
    // 毫秒截断会包裹排序列与过滤列，使索引失效；现在两处都用原始列
    expect(
      sqlOf(qb.where, qb.andWhere, qb.orderBy, qb.addOrderBy),
    ).not.toContain('date_trunc');
  });

  it('list 结果多于 limit 时裁到 limit 并返回下一页游标', async () => {
    const qb = makeKbQb();
    const rows = Array.from({ length: 3 }, (_, i) =>
      kb({ id: uuid(i), createdAt: new Date(2026, 0, 1, 0, 0, i) }),
    );
    qb.getMany.mockResolvedValue(rows);
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    const result = await service.list('u1', { limit: 2 });
    expect(qb.take).toHaveBeenCalledWith(3);
    expect(result.list).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
    // 游标指向本页最后一条（第 2 条），且编码的是 createdAt（不可变排序键）
    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded.id).toBe(uuid(1));
    expect(decoded.timestamp.toISOString()).toBe(
      rows[1].createdAt.toISOString(),
    );
  });

  it('list 带 cursor：解码为行比较 keyset 条件，非法游标抛 400', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    const cursor = encodeCursor(new Date('2026-01-01T00:00:00.000Z'), OTHER_ID);
    await service.list('u1', { cursor });
    // 行比较（tuple comparison）让 Postgres 能把它优化为一次索引扫描
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(kb.created_at, kb.id) < (:cursorTs, :cursorId)',
      {
        cursorTs: new Date('2026-01-01T00:00:00.000Z'),
        cursorId: OTHER_ID,
      },
    );

    await expect(
      service.list('u1', { cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('list visibility=private：属主私有库', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    await service.list('u1', { visibility: KnowledgeBaseVisibility.Private });
    expect(qb.where).toHaveBeenCalledWith('kb.ownerId = :uid', { uid: 'u1' });
    expect(qb.andWhere).toHaveBeenCalledWith('kb.visibility = :v', {
      v: KnowledgeBaseVisibility.Private,
    });
  });

  it('list visibility=public：公开库', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    await service.list('u1', { visibility: KnowledgeBaseVisibility.Public });
    expect(qb.where).toHaveBeenCalledWith('kb.visibility = :v', {
      v: KnowledgeBaseVisibility.Public,
    });
  });

  it('list 带 name：在括号 OR 之外追加 ILIKE 过滤（属主自己的库也参与 name 过滤）', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    await service.list('u1', { name: 'x' });
    expect(qb.where).toHaveBeenCalledWith(
      '(kb.ownerId = :uid OR kb.visibility = :pub)',
      { uid: 'u1', pub: KnowledgeBaseVisibility.Public },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('kb.name ILIKE :name', {
      name: '%x%',
    });
  });

  it('get 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.get('u1', 'kb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update 属主更新全字段并保存', async () => {
    const kbEntity = kb();
    kbRepo.findOne.mockResolvedValue(kbEntity);
    kbRepo.save.mockResolvedValue(kbEntity);
    await service.update('u1', 'kb1', {
      name: 'y',
      description: 'd',
      visibility: KnowledgeBaseVisibility.Public,
    });
    expect(kbEntity.name).toBe('y');
    expect(kbEntity.description).toBe('d');
    expect(kbEntity.visibility).toBe(KnowledgeBaseVisibility.Public);
    expect(kbRepo.save).toHaveBeenCalledWith(kbEntity);
  });

  it('update 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      service.update('u1', 'kb1', { name: 'y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove 删除知识库并清理底层文件（含文件缺失分支）', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.find.mockResolvedValue([
      doc({ fileId: 'f1' }),
      doc({ id: 'd2', fileId: 'f2' }),
    ]);
    fileRepo.findOneBy
      .mockResolvedValueOnce({ id: 'f1', key: 'f1.pdf' })
      .mockResolvedValueOnce(null);
    kbRepo.delete.mockResolvedValue({ affected: 1 });
    await service.remove('u1', 'kb1');
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: 'f1' });
    expect(kbRepo.delete).toHaveBeenCalledWith({ id: 'kb1' });
  });

  it('remove 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('u1', 'kb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('addDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('x'),
        originalname: 'a.txt',
        size: 1,
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('addDocument FILE_MAX_SIZE 非数字时回退默认上限（不静默禁用）', async () => {
    const svc = new KnowledgeService(
      logger,
      dataSource,
      kbRepo as never,
      docRepo as never,
      likeRepo as never,
      fileService as never,
      new ConfigService({ FILE_MAX_SIZE: '10MB' }),
    );
    kbRepo.findOne.mockResolvedValue(kb());
    const big = Buffer.alloc(20 * 1024 * 1024);
    await expect(
      svc.addDocument('u1', 'kb1', {
        buffer: big,
        originalname: 'a.txt',
        size: big.length,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 413 },
    });
    expect(fileService.save).not.toHaveBeenCalled();
  });

  it('addDocument 入库失败回滚删除文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(stored());
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    docRepo.save.mockRejectedValue(new Error('db fail'));
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 422 },
    });
    // 事务回滚后只需清理底层文件（数据库记录已自动回滚）
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
  });

  it('addDocument docx（非 pdf）跳过魔数校验正常入库', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(
      stored({ ext: '.docx', key: 'f1.docx' }),
    );
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    docRepo.save.mockResolvedValue(doc());
    await service.addDocument('u1', 'kb1', {
      buffer: Buffer.from('zip'),
      originalname: 'a.docx',
      size: 4,
    } as never);
    expect(detectFileType).not.toHaveBeenCalled();
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a', content: '正文', fileId: 'f1' }),
    );
  });

  it('listDocuments 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      kb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    const result = await service.listDocuments('u2', 'kb1', {});
    expect(qb.where).toHaveBeenCalledWith('d.knowledgeBaseId = :kbId', {
      kbId: 'kb1',
    });
    expect(qb.take).toHaveBeenCalledWith(21);
    expect(result.list).toEqual([
      expect.objectContaining({ id: DOC_ID, title: 'a' }),
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('listDocuments 做列投影并剔除 content：列表不返回解析全文', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.listDocuments('u1', 'kb1', {});

    // 显式列投影：content（text，可达 MB 级）不进 SELECT
    const selected = qb.select.mock.calls[0][0] as string[];
    expect(selected).toEqual([
      'd.id',
      'd.knowledgeBaseId',
      'd.fileId',
      'd.title',
      'd.createdAt',
      'd.updatedAt',
    ]);
    expect(selected).not.toContain('d.content');
    // 响应同样不含 content，只剩列表页需要的字段
    expect(result.list[0]).not.toHaveProperty('content');
    expect(Object.keys(result.list[0]).sort()).toEqual([
      'createdAt',
      'fileId',
      'id',
      'knowledgeBaseId',
      'title',
      'updatedAt',
    ]);
  });

  it('listDocuments 带 cursor：解码为行比较 keyset 条件（排序键为 created_at）', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    const cursor = encodeCursor(new Date('2026-01-01T00:00:00.000Z'), OTHER_ID);
    await service.listDocuments('u1', 'kb1', { cursor, limit: 5 });
    expect(qb.take).toHaveBeenCalledWith(6);
    expect(qb.orderBy).toHaveBeenCalledWith('d.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('d.id', 'DESC');
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.created_at, d.id) < (:cursorTs, :cursorId)',
      {
        cursorTs: new Date('2026-01-01T00:00:00.000Z'),
        cursorId: OTHER_ID,
      },
    );
    // 毫秒截断会包裹排序列与过滤列，使索引失效
    expect(
      sqlOf(qb.where, qb.andWhere, qb.orderBy, qb.addOrderBy),
    ).not.toContain('date_trunc');
  });

  it('listDocuments 结果多于 limit 时游标编码基于 createdAt', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const qb = makeDocQb();
    const rows = Array.from({ length: 3 }, (_, i) =>
      doc({ id: uuid(i), createdAt: new Date(2026, 0, 1, 0, 0, i) }),
    );
    qb.getMany.mockResolvedValue(rows);
    docRepo.createQueryBuilder.mockReturnValue(qb);
    const result = await service.listDocuments('u1', 'kb1', { limit: 2 });
    expect(result.list).toHaveLength(2);
    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded.id).toBe(uuid(1));
    expect(decoded.timestamp.toISOString()).toBe(
      rows[1].createdAt.toISOString(),
    );
  });

  it('listDocuments 带 keyword 追加 ILIKE 过滤', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    await service.listDocuments('u1', 'kb1', { keyword: 'x' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.title ILIKE :kw OR d.content ILIKE :kw)',
      { kw: '%x%' },
    );
  });

  it('listDocuments 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.listDocuments('u2', 'kb1', {})).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('listDocuments 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.listDocuments('u1', 'kb1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getDocument 属主可读，返回详情契约视图（含 content，非实体）', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc({ content: '正文' }));
    const result = await service.getDocument('u1', 'kb1', 'd1');

    expect(result).toEqual({
      id: DOC_ID,
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      content: '正文',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(docRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'd1', knowledgeBaseId: 'kb1' },
    });
  });

  it('getDocument 文档不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(null);
    await expect(service.getDocument('u1', 'kb1', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.getDocument('u1', 'kb1', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getDocument 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.getDocument('u2', 'kb1', 'd1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('removeDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      service.removeDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument 文档不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(null);
    await expect(
      service.removeDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument file 为 null 仍删文档行', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileRepo.findOneBy.mockResolvedValue(null);
    docRepo.delete.mockResolvedValue({ affected: 1 });
    await service.removeDocument('u1', 'kb1', 'd1');
    expect(docRepo.delete).toHaveBeenCalledWith({
      id: 'd1',
      knowledgeBaseId: 'kb1',
    });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: 'f1' });
    expect(fileService.remove).not.toHaveBeenCalled();
  });

  it('removeDocument 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.removeDocument('u2', 'kb1', 'd1'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('like 首次点赞落库成功，返回 likeCount 与 isLiked', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    likeRepo.findOneBy.mockResolvedValue(null);
    likeRepo.save.mockResolvedValue({});
    likeRepo.count.mockResolvedValue(1);
    await expect(service.like('u1', 'kb1')).resolves.toEqual({
      likeCount: 1,
      isLiked: true,
    });
    expect(likeRepo.findOneBy).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb1',
      userId: 'u1',
    });
    expect(likeRepo.save).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb1',
      userId: 'u1',
    });
    expect(likeRepo.count).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb1' },
    });
  });

  it('like 重复点赞抛 409', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    likeRepo.findOneBy.mockResolvedValue({ id: 'like1' });
    await expect(service.like('u1', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(likeRepo.save).not.toHaveBeenCalled();
  });

  it('like 并发竞态：save 触发 UNIQUE 约束冲突抛 409', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    likeRepo.findOneBy.mockResolvedValue(null);
    // 模拟 PostgreSQL UNIQUE 约束冲突 (error code 23505)
    const uniqueError = new Error(
      'duplicate key value violates unique constraint',
    ) as Error & { code?: string };
    uniqueError.code = '23505';
    likeRepo.save.mockRejectedValue(uniqueError);
    await expect(service.like('u1', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('like 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.like('u1', 'kb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('like 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.like('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('unlike 取消点赞成功，返回 likeCount 与 isLiked', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    likeRepo.delete.mockResolvedValue({ affected: 1 });
    likeRepo.count.mockResolvedValue(0);
    await expect(service.unlike('u1', 'kb1')).resolves.toEqual({
      likeCount: 0,
      isLiked: false,
    });
    expect(likeRepo.delete).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb1',
      userId: 'u1',
    });
    expect(likeRepo.count).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb1' },
    });
  });

  it('unlike 未点赞也成功（幂等），返回 likeCount 0', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    likeRepo.delete.mockResolvedValue({ affected: 0 });
    likeRepo.count.mockResolvedValue(0);
    await expect(service.unlike('u1', 'kb1')).resolves.toEqual({
      likeCount: 0,
      isLiked: false,
    });
  });

  it('unlike 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.unlike('u1', 'kb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('unlike 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.unlike('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });
});
