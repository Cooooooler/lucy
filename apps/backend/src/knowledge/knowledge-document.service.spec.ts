import { FileService } from '@coool/file-nest';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import { MAX_PAGE_SIZE } from '../common/pagination/pagination.constants.js';
import {
  DOC_ID,
  makeDoc,
  makeDocQb,
  makeFile,
  makeKb,
  makeStored,
} from '../test/knowledge.fixtures.js';
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
// 只打桩解析函数，保留**真实的** SUPPORTED_DOCUMENT_EXTS：白名单是安全相关的入参校验，
// 在 mock 里复制一份会让「生产白名单增删扩展名」没有任何用例失败
vi.mock('./content-extractor.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./content-extractor.js')>();
  return { ...actual, extractContent: vi.fn() };
});

import { extractContent } from './content-extractor.js';
import { detectFileType } from './magic-bytes.js';

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
  // 保留可断言的 mock 句柄（直接对 `logger.warn` 断言会触发 unbound-method）
  const loggerMock = { log: vi.fn(), warn: vi.fn() };
  const logger = loggerMock as unknown as AppLogger;

  let docService: KnowledgeDocumentService;

  /**
   * 经 DI 容器装配服务：provider 是否注册、注入 token 是否正确由容器判定。
   */
  const buildService = async (
    configService: ConfigService = config,
  ): Promise<KnowledgeDocumentService> => {
    const moduleRef = await Test.createTestingModule({
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
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    fileService.save.mockResolvedValue(makeStored());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(makeStored());
    // 与 TypeORM 行为一致：save 返回带全部列的实体（上传响应要把文件元数据回填给前端）
    fileRepo.save.mockResolvedValue(makeFile({ size: 4 }));
    docRepo.save.mockResolvedValue(makeDoc({ content: '正文' }));
    const uploaded = await docService.addDocument('u1', 'kb1', {
      buffer: Buffer.from('%PDF'),
      originalname: 'a.pdf',
      size: 4,
    } as never);
    // 上传返回详情契约视图（与 getDocument 同形，含 content 与文件元数据），不是实体本身
    expect(uploaded).toEqual({
      id: DOC_ID,
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: 4,
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

  it('addDocument 非属主抛 FORBIDDEN：鉴权先于落盘（不触发 fileService.save）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb({ ownerId: 'u2' }));
    await expect(
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('x'),
        originalname: 'a.txt',
        size: 1,
      } as never),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(fileService.save).not.toHaveBeenCalled();
  });

  it('addDocument FILE_MAX_SIZE 非数字时回退默认上限（不静默禁用）', async () => {
    const svc = await buildService(
      new ConfigService({ FILE_MAX_SIZE: '10MB' }),
    );
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(makeStored());
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

  it('addDocument 解析失败且清理文件也失败：原始 422 照常返回（清理只告警）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    fileService.save.mockResolvedValue(makeStored());
    vi.mocked(extractContent).mockRejectedValue(new Error('parse fail'));
    fileService.remove.mockRejectedValue(new Error('storage down'));
    await expect(
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.txt',
        size: 4,
      } as never),
    ).rejects.toMatchObject({ response: { statusCode: 422 } });
    // best-effort：清理失败不得顶替调用方的原始错误（否则 422 会变成 500）
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('addDocument 入库失败且清理也失败：原始错误照常上抛（清理只告警）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(makeStored());
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    docRepo.save.mockRejectedValue(new Error('db fail'));
    fileService.remove.mockRejectedValue(new Error('storage down'));
    await expect(
      docService.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toThrow('db fail');
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('addDocument docx（非 pdf）跳过魔数校验正常入库', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue(
      makeStored({ ext: '.docx', key: 'f1.docx' }),
    );
    fileRepo.save.mockResolvedValue({ id: 'f1' });
    docRepo.save.mockResolvedValue(makeDoc());
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

  it('listDocuments 公开库非属主可读，按页码分页返回 total', async () => {
    kbRepo.findOne.mockResolvedValue(
      makeKb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    const qb = makeDocQb();
    qb.getManyAndCount.mockResolvedValue([[makeDoc()], 42]);
    docRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await docService.listDocuments('u2', 'kb1', {
      page: 3,
      pageSize: 5,
    });

    expect(qb.where).toHaveBeenCalledWith('d.knowledgeBaseId = :kbId', {
      kbId: 'kb1',
    });
    // OFFSET = (page - 1) * pageSize
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(qb.orderBy).toHaveBeenCalledWith('d.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('d.id', 'DESC');
    expect(result).toMatchObject({ total: 42, page: 3, pageSize: 5 });
    expect(result.list).toEqual([
      expect.objectContaining({ id: DOC_ID, title: 'a' }),
    ]);
  });

  it('listDocuments 归一化非法页码/每页条数（pageSize 越界不会变成全量扫描）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);

    await docService.listDocuments('u1', 'kb1', { page: 0, pageSize: 1e6 });

    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
  });

  it('listDocuments 做列投影并 join files：不返回解析全文，带文件元数据', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await docService.listDocuments('u1', 'kb1', {});

    // file_id 是 NOT NULL 外键（onDelete CASCADE），内连接不会丢行；文件元数据随列表一起取
    expect(qb.innerJoin).toHaveBeenCalledWith('d.file', 'f');
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
    expect(qb.addSelect).toHaveBeenCalledWith([
      'f.originalName',
      'f.ext',
      'f.mime',
      'f.size',
    ]);
    // 响应同样不含 content，只剩列表页需要的字段 + 文件元数据
    expect(result.list[0]).not.toHaveProperty('content');
    expect(
      Object.keys(result.list[0]).sort((a, b) => a.localeCompare(b)),
    ).toEqual([
      'createdAt',
      'ext',
      'fileId',
      'id',
      'knowledgeBaseId',
      'mime',
      'originalName',
      'size',
      'title',
      'updatedAt',
    ]);
    expect(result.list[0]).toMatchObject({
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: 1024,
    });
  });

  it('listDocuments 带 keyword 追加 ILIKE 过滤', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    const qb = makeDocQb();
    docRepo.createQueryBuilder.mockReturnValue(qb);
    await docService.listDocuments('u1', 'kb1', { keyword: 'x' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(d.title ILIKE :kw OR d.content ILIKE :kw)',
      { kw: '%x%' },
    );
  });

  it('listDocuments 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
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

  it('getDocument 属主可读，返回详情契约视图（含 content 与文件元数据，非实体）', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.findOne.mockResolvedValue(makeDoc({ content: '正文' }));
    const result = await docService.getDocument('u1', 'kb1', 'd1');

    expect(result).toEqual({
      id: DOC_ID,
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: 1024,
      content: '正文',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    // 详情契约含文件元数据：必须显式加载 file 关系，否则文件名会静默变成空串
    expect(docRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'd1', knowledgeBaseId: 'kb1' },
      relations: { file: true },
    });
  });

  it('getDocument 文档不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(
      docService.getDocument('u2', 'kb1', 'd1'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('removeDocument 删文档并清文件', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.findOne.mockResolvedValue(makeDoc());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.removeDocument('u1', 'kb1', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument file 为 null 仍删文档行', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.findOne.mockResolvedValue(makeDoc());
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
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(
      docService.removeDocument('u2', 'kb1', 'd1'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('removeAllForKnowledgeBase 级联删文档/文件/知识库行并清理底层文件', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.find.mockResolvedValue([
      makeDoc({ fileId: 'f1' }),
      makeDoc({ id: 'd2', fileId: 'f2' }),
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

  it('removeAllForKnowledgeBase 空文档库：不触发空条件的 findBy/delete', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    docRepo.find.mockResolvedValue([]);
    kbRepo.delete.mockResolvedValue({ affected: 1 });
    await docService.removeAllForKnowledgeBase('u1', 'kb1');
    // `In([])` 会触发 TypeORM「Empty criteria(s) are not allowed」：空集必须短路
    expect(fileRepo.findBy).not.toHaveBeenCalled();
    expect(fileRepo.delete).not.toHaveBeenCalled();
    expect(docRepo.delete).toHaveBeenCalledWith({ knowledgeBaseId: 'kb1' });
    expect(kbRepo.delete).toHaveBeenCalledWith({ id: 'kb1' });
  });

  it('removeAllForKnowledgeBase 知识库不存在抛 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(
      docService.removeAllForKnowledgeBase('u1', 'kb1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeAllForKnowledgeBase 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(makeKb());
    await expect(
      docService.removeAllForKnowledgeBase('u2', 'kb1'),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(docRepo.find).not.toHaveBeenCalled();
  });
});
