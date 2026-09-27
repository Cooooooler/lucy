import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import {
  KB_ID,
  KB_ITEM_KEYS,
  makeKb,
  makeKbItem,
  makeKbQb,
  makeLikeQb,
  OTHER_ID,
  sqlOf,
  uuid,
} from '../test/knowledge.fixtures.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';
import { KnowledgeService } from './knowledge.service.js';

describe('KnowledgeService', () => {
  const kbRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const likeRepo = {
    findOneBy: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  // 文档/文件的级联清理已下沉到 KnowledgeDocumentService：本 spec 只断言委托，
  // 其内部行为（事务、N+1、文件清理）在 knowledge-document.service.spec.ts 覆盖
  const documentService = {
    removeAllForKnowledgeBase: vi.fn(),
  };
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLogger;

  let service: KnowledgeService;

  /**
   * 经 DI 容器装配服务：provider 是否注册、注入 token 是否正确由容器判定。
   * `KeysetPaginator` 刻意不在这里 provide，而是走 `imports: [PaginationModule]`：
   * 与生产一致的模块路径才会验证 `PaginationModule` 真的 exports 了它。
   */
  const buildService = async (): Promise<KnowledgeService> => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaginationModule],
      providers: [
        KnowledgeService,
        { provide: AppLogger, useValue: logger },
        { provide: getRepositoryToken(KnowledgeBase), useValue: kbRepo },
        { provide: getRepositoryToken(KnowledgeLike), useValue: likeRepo },
        { provide: KnowledgeDocumentService, useValue: documentService },
      ],
    }).compile();
    return moduleRef.get(KnowledgeService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // 点赞态回填（fillLikeInfo）被 get/list/update 共用：默认给一个空结果的可链式 stub，
    // 避免依赖「上个用例遗留的 mockReturnValue」——clearAllMocks 只清调用记录不清实现
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    service = await buildService();
  });

  it('create 保存知识库（默认 private）并返回契约视图', async () => {
    kbRepo.save.mockResolvedValue(makeKb());
    const result = await service.create('u1', { name: 'x' });
    expect(result).toEqual(makeKbItem());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    const result = await service.get('u1', 'kb1');
    expect(result).toEqual(makeKbItem());
    expect(result.likeCount).toBe(0);
    expect(result.isLiked).toBe(false);
  });

  it('get 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      makeKb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    await expect(service.get('u2', 'kb1')).resolves.toEqual(
      makeKbItem({ visibility: KnowledgeBaseVisibility.Public }),
    );
  });

  it('create/get/list/update 字段集完全一致（契约不随端点漂移）', async () => {
    kbRepo.save.mockResolvedValue(makeKb());
    const created = await service.create('u1', { name: 'x' });

    kbRepo.findOne.mockResolvedValue(makeKb());
    const detail = await service.get('u1', KB_ID);

    kbRepo.createQueryBuilder.mockReturnValue(makeKbQb());
    const listed = await service.list('u1', {});

    kbRepo.findOne.mockResolvedValue(makeKb());
    kbRepo.save.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    kbRepo.save.mockResolvedValue(makeKb());
    const likeQb = makeLikeQb();
    likeQb.getRawMany.mockResolvedValue([{ kbId: KB_ID, cnt: '3' }]);
    likeRepo.createQueryBuilder.mockReturnValue(likeQb);

    const result = await service.update('u1', KB_ID, { name: 'y' });

    expect(result.likeCount).toBe(3);
    expect(result.isLiked).toBe(true);
  });

  it('get 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(service.get('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { statusCode: 403 },
    });
  });

  it('update 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(
      service.update('u2', 'kb1', { name: 'y' }),
    ).rejects.toMatchObject({
      response: { statusCode: 403 },
    });
  });

  it('remove 委托文档服务做级联清理与鉴权（本服务不再直接操作文档/文件）', async () => {
    await service.remove('u1', 'kb1');
    expect(documentService.removeAllForKnowledgeBase).toHaveBeenCalledWith(
      'u1',
      'kb1',
    );
  });

  it('list 默认可见性：属主或公开库（括号包裹 OR），返回 list/nextCursor，附带 likeCount/isLiked', async () => {
    const qb = makeKbQb();
    qb.getMany.mockResolvedValue([makeKb()]);
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
      list: [makeKbItem()],
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
    await service.list('u1', {
      cursor: encodeCursor(new Date(), uuid(9), 'createdAt'),
    });
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
      makeKb({ id: uuid(i), createdAt: new Date(2026, 0, 1, 0, 0, i) }),
    );
    qb.getMany.mockResolvedValue(rows);
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    const result = await service.list('u1', { limit: 2 });
    expect(qb.take).toHaveBeenCalledWith(3);
    expect(result.list).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
    // 游标指向本页最后一条（第 2 条），且编码的是 createdAt（不可变排序键）
    const decoded = decodeCursor(result.nextCursor!, 'createdAt');
    expect(decoded.id).toBe(uuid(1));
    expect(decoded.timestamp.toISOString()).toBe(
      rows[1].createdAt.toISOString(),
    );
  });

  it('list 带 cursor：解码为行比较 keyset 条件，非法游标抛 400', async () => {
    const qb = makeKbQb();
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    const cursor = encodeCursor(
      new Date('2026-01-01T00:00:00.000Z'),
      OTHER_ID,
      'createdAt',
    );
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
    const kbEntity = makeKb();
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

  it('like 首次点赞落库成功，返回 likeCount 与 isLiked', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    likeRepo.findOneBy.mockResolvedValue({ id: 'like1' });
    await expect(service.like('u1', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(likeRepo.save).not.toHaveBeenCalled();
  });

  it('like 并发竞态：save 触发 UNIQUE 约束冲突抛 409', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(service.like('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('unlike 取消点赞成功，返回 likeCount 与 isLiked', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(service.unlike('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });
});
