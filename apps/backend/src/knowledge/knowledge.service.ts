import { FileService } from '@coool/file-nest';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { basename, extname } from 'node:path';
import { Repository } from 'typeorm';
import {
  extractContent,
  SUPPORTED_DOCUMENT_EXTS,
} from './content-extractor.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { detectFileType } from './magic-bytes.js';

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(BackendFileEntity)
    private readonly fileRepo: Repository<BackendFileEntity>,
    private readonly fileService: FileService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 创建一个知识库。
   * @param userId 属主用户 ID
   * @param dto 创建参数（名称必填，描述/可见性可选）
   * @returns 持久化后的知识库
   */
  create(userId: string, dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return this.kbRepo.save({
      ownerId: userId,
      name: dto.name,
      description: dto.description ?? null,
      visibility: dto.visibility ?? KnowledgeBaseVisibility.Private,
    });
  }

  /**
   * 分页查询知识库列表。
   * 默认返回当前用户拥有的 + 公开的知识库；可按 `visibility` / 名称关键字过滤。
   * @param userId 当前用户 ID
   * @param query 分页与过滤参数
   * @returns 分页结果（list/total/page/pageSize）
   */
  async list(
    userId: string,
    query: KnowledgeListQueryDto,
  ): Promise<{
    list: KnowledgeBase[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.kbRepo
      .createQueryBuilder('kb')
      .orderBy('kb.updatedAt', 'DESC');
    if (query.visibility) {
      if (query.visibility === KnowledgeBaseVisibility.Private) {
        qb.where('kb.ownerId = :uid', { uid: userId }).andWhere(
          'kb.visibility = :v',
          {
            v: KnowledgeBaseVisibility.Private,
          },
        );
      } else {
        qb.where('kb.visibility = :v', { v: KnowledgeBaseVisibility.Public });
      }
    } else {
      qb.where('(kb.ownerId = :uid OR kb.visibility = :pub)', {
        uid: userId,
        pub: KnowledgeBaseVisibility.Public,
      });
    }
    if (query.name) {
      qb.andWhere('kb.name ILIKE :name', { name: `%${query.name}%` });
    }
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 获取知识库详情。
   * @throws NotFoundException 知识库不存在
   * @throws ForbiddenException 用户无权访问（既非属主，也非公开）
   */
  async get(userId: string, id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    return kb;
  }

  /**
   * 更新知识库元信息。
   * 仅属主可操作；只更新 DTO 中显式提供的字段。
   * @throws NotFoundException / ForbiddenException
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description;
    if (dto.visibility !== undefined) kb.visibility = dto.visibility;
    return this.kbRepo.save(kb);
  }

  /**
   * 删除知识库（级联清空其下所有文档与底层文件）。
   * @throws NotFoundException / ForbiddenException
   */
  async remove(userId: string, id: string): Promise<null> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    // 清理该库下所有文档的底层文件，避免孤儿
    const docs = await this.docRepo.find({ where: { knowledgeBaseId: id } });
    for (const d of docs) {
      const file = await this.fileRepo.findOneBy({ id: d.fileId });
      if (file) {
        await this.fileService.remove(file.key);
        await this.fileRepo.delete({ id: file.id });
      }
    }
    await this.kbRepo.delete({ id });
    return null;
  }

  /**
   * 上传并解析一个文档到指定知识库。
   * 流程：扩展名校验 → 大小校验 → PDF 魔数校验 → 落底层存储 →
   *       解析文本 → 落库；任一步失败会回滚已落库的文件。
   * @throws UnsupportedMediaTypeException / PayloadTooLargeException / UnprocessableEntityException
   */
  async addDocument(
    userId: string,
    kbId: string,
    file: Express.Multer.File,
  ): Promise<KnowledgeDocument> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);

    const origExt = extname(file.originalname).toLowerCase();
    if (!SUPPORTED_DOCUMENT_EXTS.includes(origExt)) {
      throw new UnsupportedMediaTypeException(
        '不支持的文档类型，仅支持 txt/md/pdf/docx',
      );
    }
    const parsed = Number(this.config.get<number>('FILE_MAX_SIZE', 10485760));
    const maxSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 10485760;
    if (file.size > maxSize) {
      throw new PayloadTooLargeException('文件超过大小上限');
    }
    // pdf 用魔数防伪装（docx 是 zip 容器魔数不可靠，靠 mammoth 解析兜底）
    if (origExt === '.pdf') {
      const detected = await detectFileType(file.buffer);
      if (detected?.ext !== 'pdf') {
        throw new UnsupportedMediaTypeException('PDF 文件内容与扩展名不符');
      }
    }

    const stored = await this.fileService.save({
      buffer: file.buffer,
      ext: origExt,
      mime: file.mimetype,
    });

    const fileEntity = await this.fileRepo.save({
      ownerId: userId,
      originalName: file.originalname,
      ext: stored.ext,
      mime: stored.mime,
      size: stored.size,
      key: stored.key,
      hash: stored.hash,
      storage: stored.storage,
    });

    let content: string;
    try {
      content = await extractContent(file.buffer, origExt);
    } catch {
      await this.fileService.remove(stored.key);
      await this.fileRepo.delete({ id: fileEntity.id });
      throw new UnprocessableEntityException('文档解析失败');
    }

    const title = basename(file.originalname, extname(file.originalname));
    try {
      return await this.docRepo.save({
        knowledgeBaseId: kbId,
        fileId: fileEntity.id,
        title,
        content,
      });
    } catch (err) {
      await this.fileService.remove(stored.key);
      await this.fileRepo.delete({ id: fileEntity.id });
      throw err;
    }
  }

  /**
   * 分页查询某知识库下的文档。
   * 可按 `keyword` 模糊匹配标题或解析出的纯文本。
   * @throws NotFoundException / ForbiddenException
   */
  async listDocuments(
    userId: string,
    kbId: string,
    query: DocumentListQueryDto,
  ): Promise<{
    list: KnowledgeDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.docRepo
      .createQueryBuilder('d')
      .where('d.knowledgeBaseId = :kbId', { kbId })
      .orderBy('d.createdAt', 'DESC');
    if (query.keyword) {
      qb.andWhere('(d.title ILIKE :kw OR d.content ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 获取文档详情（含解析文本）。
   * @throws NotFoundException / ForbiddenException
   */
  async getDocument(
    userId: string,
    kbId: string,
    id: string,
  ): Promise<KnowledgeDocument> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    return doc;
  }

  /**
   * 删除某知识库下的一个文档（连带清理底层文件）。
   * @throws NotFoundException / ForbiddenException
   */
  async removeDocument(
    userId: string,
    kbId: string,
    id: string,
  ): Promise<null> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    await this.docRepo.delete({ id, knowledgeBaseId: kbId });
    const file = await this.fileRepo.findOneBy({ id: doc.fileId });
    if (file) await this.fileService.remove(file.key);
    await this.fileRepo.delete({ id: doc.fileId });
    return null;
  }

  private assertOwner(kb: KnowledgeBase, userId: string): void {
    if (kb.ownerId !== userId) {
      throw new ForbiddenException('仅知识库属主可操作');
    }
  }

  private assertReadable(kb: KnowledgeBase, userId: string): void {
    if (kb.ownerId === userId) return;
    if (kb.visibility === KnowledgeBaseVisibility.Public) return;
    throw new ForbiddenException('无权访问该知识库');
  }
}
