import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    service = new KnowledgeService(
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
      id: 'kb1',
      ownerId: 'u1',
      visibility: KnowledgeBaseVisibility.Private,
      name: '产品文档',
      description: null,
      ...over,
    });
  const doc = (over = {}) =>
    Object.assign(new KnowledgeDocument(), {
      id: 'd1',
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      content: null,
      ...over,
    });

  // 可链式 QueryBuilder mock：记录 where/orWhere/andWhere 等调用参数，供 list 用
  const makeKbQb = () => {
    const qb = {
      where: vi.fn(),
      orWhere: vi.fn(),
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      addOrderBy: vi.fn(),
      skip: vi.fn(),
      take: vi.fn(),
      getManyAndCount: vi.fn(),
    };
    qb.where.mockReturnValue(qb);
    qb.orWhere.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.addOrderBy.mockReturnValue(qb);
    qb.skip.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.getManyAndCount.mockResolvedValue([[kb()], 1]);
    return qb;
  };

  // 可链式 QueryBuilder mock：供 listDocuments 用（docRepo）
  const makeDocQb = () => {
    const qb = {
      where: vi.fn(),
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      addOrderBy: vi.fn(),
      skip: vi.fn(),
      take: vi.fn(),
      getManyAndCount: vi.fn(),
    };
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.addOrderBy.mockReturnValue(qb);
    qb.skip.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.getManyAndCount.mockResolvedValue([[doc()], 1]);
    return qb;
  };

  it('create 保存知识库（默认 private）', async () => {
    kbRepo.save.mockResolvedValue(kb());
    await expect(service.create('u1', { name: 'x' })).resolves.toBeInstanceOf(
      KnowledgeBase,
    );
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
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    const result = await service.get('u1', 'kb1');
    expect(result).toEqual(expect.any(KnowledgeBase));
    expect(result.likeCount).toBe(0);
    expect(result.isLiked).toBe(false);
  });

  it('get 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      kb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    likeRepo.createQueryBuilder.mockReturnValue(makeLikeQb());
    await expect(service.get('u2', 'kb1')).resolves.toEqual(
      expect.any(KnowledgeBase),
    );
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
    await service.addDocument('u1', 'kb1', {
      buffer: Buffer.from('%PDF'),
      originalname: 'a.pdf',
      size: 4,
    } as never);
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

  it('list 默认可见性：属主或公开库（括号包裹 OR），返回 list/total/page/pageSize，附带 likeCount/isLiked', async () => {
    const qb = makeKbQb();
    qb.getManyAndCount.mockResolvedValue([[kb()], 1]);
    kbRepo.createQueryBuilder.mockReturnValue(qb);
    const likeQb = makeLikeQb();
    likeRepo.createQueryBuilder.mockReturnValue(likeQb);
    const result = await service.list('u1', {});
    expect(qb.where).toHaveBeenCalledWith(
      '(kb.ownerId = :uid OR kb.visibility = :pub)',
      { uid: 'u1', pub: KnowledgeBaseVisibility.Public },
    );
    expect(qb.orWhere).not.toHaveBeenCalled();
    expect(qb.getManyAndCount).toHaveBeenCalled();
    expect(result).toEqual({
      list: [expect.any(KnowledgeBase)],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    // 验证 like 回写
    expect(likeRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(result.list[0].likeCount).toBe(0);
    expect(result.list[0].isLiked).toBe(false);
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
    expect(result).toEqual({
      list: [expect.any(KnowledgeDocument)],
      total: 1,
      page: 1,
      pageSize: 20,
    });
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

  it('getDocument 属主可读返回嵌套文档', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    await expect(service.getDocument('u1', 'kb1', 'd1')).resolves.toEqual(
      expect.any(KnowledgeDocument),
    );
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
