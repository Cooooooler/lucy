import { FileService } from '@coool/file-nest';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';

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

describe('KnowledgeDocumentService', () => {
  const kbRepo = {
    findOne: vi.fn(),
    delete: vi.fn(),
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
    findBy: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
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

  let docService: KnowledgeDocumentService;

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

  /**
   * 主别名 + 实体元数据 stub：`KeysetPaginator` 从 QueryBuilder 自身解析别名与排序列名，
   * 故 mock 的 QueryBuilder 要提供 `expressionMap.mainAlias`；列名映射与实体上的 `name:` 一致。
   */
  const aliasStub = (name: string) => ({
    name,
    hasMetadata: true,
    metadata: {
      name: `${name}Entity`,
      findColumnWithPropertyName: (property: string) => ({
        databaseName: property === 'createdAt' ? 'created_at' : 'id',
      }),
    },
  });

  // 可链式 QueryBuilder mock：供 listDocuments 用（docRepo）
  const makeDocQb = () => {
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

  /**
   * 经 DI 容器装配服务：provider 是否注册、注入 token 是否正确由容器判定。
   * `KeysetPaginator` 刻意不在这里 provide，而是走 `imports: [PaginationModule]`：
   * 与生产一致的模块路径才会验证 `PaginationModule` 真的 exports 了它。
   */
  const buildService = async (
    configService: ConfigService = config,
  ): Promise<KnowledgeDocumentService> => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaginationModule],
      providers: [
        KnowledgeDocumentService,
        { provide: AppLogger, useValue: logger },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(KnowledgeBase), useValue: kbRepo },
        { provide: getRepositoryToken(KnowledgeDocument), useValue: docRepo },
        { provide: FileService, useValue: fileService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    return moduleRef.get(KnowledgeDocumentService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    docService = await buildService();
  });

  it('addDocument 校验非法扩展名', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      docService.addDocument('u1', 'kb1', {
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
      docService.addDocument('u1', 'kb1', {
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
      docService.addDocument('u1', 'kb1', {
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
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 422 },
    });
    // 解析失败只需清理底层文件（数据库记录尚未写入）
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
    const uploaded = await docService.addDocument('u1', 'kb1', {
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

  it('addDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('x'),
        originalname: 'a.txt',
        size: 1,
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('addDocument FILE_MAX_SIZE 非数字时回退默认上限（不静默禁用）', async () => {
    const svc = await buildService(
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
    // DB 故障不是「内容不可处理」：原样上抛（不再被误报成 422），且仍清理已上传文件
    await expect(
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toThrow('db fail');
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
    await docService.addDocument('u1', 'kb1', {
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
    const result = await docService.listDocuments('u2', 'kb1', {});
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

    const result = await docService.listDocuments('u1', 'kb1', {});

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
    const cursor = encodeCursor(
      new Date('2026-01-01T00:00:00.000Z'),
      OTHER_ID,
      'createdAt',
    );
    await docService.listDocuments('u1', 'kb1', { cursor, limit: 5 });
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
    const result = await docService.listDocuments('u1', 'kb1', { limit: 2 });
    expect(result.list).toHaveLength(2);
    const decoded = decodeCursor(result.nextCursor!, 'createdAt');
    expect(decoded.id).toBe(uuid(1));
    expect(decoded.timestamp.toISOString()).toBe(
      rows[1].createdAt.toISOString(),
    );
  });

  it('listDocuments 带 keyword 追加 ILIKE 过滤', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    await docService.listDocuments('u1', 'kb1', { keyword: 'x' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.title ILIKE :kw OR d.content ILIKE :kw)',
      { kw: '%x%' },
    );
  });

  it('listDocuments 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      docService.listDocuments('u2', 'kb1', {}),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('listDocuments 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.listDocuments('u1', 'kb1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getDocument 属主可读，返回详情契约视图（含 content，非实体）', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc({ content: '正文' }));
    const result = await docService.getDocument('u1', 'kb1', 'd1');

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
    await expect(
      docService.getDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.getDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getDocument 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      docService.getDocument('u2', 'kb1', 'd1'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('removeDocument 删文档并清文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileRepo.findOneBy.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.delete.mockResolvedValue({ affected: 1 });
    fileRepo.delete.mockResolvedValue({ affected: 1 });
    await docService.removeDocument('u1', 'kb1', 'd1');
    expect(docRepo.delete).toHaveBeenCalledWith({
      id: 'd1',
      knowledgeBaseId: 'kb1',
    });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: 'f1' });
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
  });

  it('removeDocument 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.removeDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument 文档不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.removeDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument file 为 null 仍删文档行', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileRepo.findOneBy.mockResolvedValue(null);
    docRepo.delete.mockResolvedValue({ affected: 1 });
    await docService.removeDocument('u1', 'kb1', 'd1');
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
      docService.removeDocument('u2', 'kb1', 'd1'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('removeAllForKnowledgeBase 级联删文档/文件/知识库行并清理底层文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.find.mockResolvedValue([
      doc({ fileId: 'f1' }),
      doc({ id: 'd2', fileId: 'f2' }),
    ]);
    // 一次 findBy 取回全部文件行：仅 f1 有文件行（f2 缺失）
    fileRepo.findBy.mockResolvedValue([{ id: 'f1', key: 'f1.pdf' }]);
    kbRepo.delete.mockResolvedValue({ affected: 1 });
    await docService.removeAllForKnowledgeBase('u1', 'kb1');
    // 删除路径只取 id/fileId：不带 text 的 content（可达 MB 级）
    expect(docRepo.find).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb1' },
      select: { id: true, fileId: true },
    });
    // 不再逐文档 findOneBy，而是一次 findBy + 一次 delete（避免 N+1）
    expect(fileRepo.findBy).toHaveBeenCalledWith({ id: In(['f1', 'f2']) });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: In(['f1', 'f2']) });
    expect(docRepo.delete).toHaveBeenCalledWith({ knowledgeBaseId: 'kb1' });
    expect(fileService.remove).toHaveBeenCalledWith('f1.pdf');
    expect(kbRepo.delete).toHaveBeenCalledWith({ id: 'kb1' });
  });

  it('removeAllForKnowledgeBase 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.removeAllForKnowledgeBase('u1', 'kb1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeAllForKnowledgeBase 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      docService.removeAllForKnowledgeBase('u2', 'kb1'),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(docRepo.find).not.toHaveBeenCalled();
  });
});
