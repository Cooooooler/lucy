import { ErrorCode } from '@lucy/shared';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  };
  const fileService = {
    save: vi.fn(),
    findById: vi.fn(),
    remove: vi.fn(),
  };
  const config = new ConfigService({ FILE_MAX_SIZE: 1024 });

  let service: KnowledgeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KnowledgeService(
      kbRepo as never,
      docRepo as never,
      fileService as never,
      config,
    );
  });

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

  it('get 属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.get('u1', 'kb1')).resolves.toEqual(
      expect.any(KnowledgeBase),
    );
  });

  it('get 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      kb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    await expect(service.get('u2', 'kb1')).resolves.toEqual(
      expect.any(KnowledgeBase),
    );
  });

  it('get 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.get('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
    });
  });

  it('update 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.update('u2', 'kb1', { name: 'y' }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
    });
  });

  it('remove 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.remove('u2', 'kb1')).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
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
      response: { code: ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE },
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
      response: { code: ErrorCode.KNOWLEDGE_FILE_TOO_LARGE },
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
      response: { code: ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE },
    });
  });

  it('addDocument 解析失败回滚删除文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    fileService.save.mockResolvedValue({
      id: 'f1',
      key: 'f1.pdf',
      storage: 'local',
    });
    vi.mocked(extractContent).mockRejectedValue(new Error('parse fail'));
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FILE_PARSE_FAILED },
    });
    expect(fileService.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
    );
  });

  it('addDocument 正常上传并入库', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    vi.mocked(detectFileType).mockResolvedValue({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    vi.mocked(extractContent).mockResolvedValue('正文');
    fileService.save.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.save.mockResolvedValue(doc({ content: '正文' }));
    await service.addDocument('u1', 'kb1', {
      buffer: Buffer.from('%PDF'),
      originalname: 'a.pdf',
      size: 4,
    } as never);
    expect(fileService.save).toHaveBeenCalled();
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a', content: '正文' }),
    );
  });

  it('removeDocument 删文档并清文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileService.findById.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.delete.mockResolvedValue({ affected: 1 });
    await service.removeDocument('u1', 'kb1', 'd1');
    expect(docRepo.delete).toHaveBeenCalledWith({
      id: 'd1',
      knowledgeBaseId: 'kb1',
    });
    expect(fileService.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
    );
  });
});
