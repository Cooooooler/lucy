import { FileService } from '@coool/file-nest';
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { basename, extname } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { KeysetPaginator } from '../common/pagination/keyset-paginator.js';
import {
  extractContent,
  SUPPORTED_DOCUMENT_EXTS,
} from './content-extractor.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import type {
  DocumentListResultDto,
  KnowledgeDocumentDetailDto,
} from './dto/knowledge-list-result.dto.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { assertOwner, assertReadable } from './knowledge-access.js';
import { toDocumentDetail, toDocumentListItem } from './knowledge.mapper.js';
import { detectFileType } from './magic-bytes.js';

/**
 * 文档领域服务：负责上传解析、列表、详情、删除，以及底层文件存储的读写。
 *
 * 从 `KnowledgeService` 拆出（`arch-single-responsibility`）：文档处理与知识库元信息 CRUD
 * 是两件独立的事——前者涉及 multipart 校验、魔数嗅探、文本抽取、底层存储 I/O 与事务回滚，
 * 后者只是元信息的增删改查。知识库的**可见性判定**（属主/公开）由 `knowledge-access.ts`
 * 共用，两个服务都先解析知识库再据此鉴权。
 */
@Injectable()
export class KnowledgeDocumentService {
  constructor(
    private readonly logger: AppLogger,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    private readonly fileService: FileService,
    private readonly config: ConfigService,
    private readonly paginator: KeysetPaginator,
  ) {}

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
  ): Promise<KnowledgeDocumentDetailDto> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertOwner(kb, userId);

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

    // 事务：保存文件记录 + 文档记录，任一步失败自动回滚
    let doc: KnowledgeDocument;
    try {
      doc = await this.dataSource.transaction(async (manager) => {
        const fileRepo = manager.getRepository(BackendFileEntity);
        const docRepo = manager.getRepository(KnowledgeDocument);

        const fileEntity = await fileRepo.save({
          ownerId: userId,
          originalName: file.originalname,
          ext: stored.ext,
          mime: stored.mime,
          size: stored.size,
          key: stored.key,
          hash: stored.hash,
          storage: stored.storage,
        });

        const content = await extractContent(file.buffer, origExt);
        const title = basename(file.originalname, extname(file.originalname));

        return docRepo.save({
          knowledgeBaseId: kbId,
          fileId: fileEntity.id,
          title,
          content,
        });
      });
    } catch (err) {
      // 事务回滚后清理已上传的底层文件
      await this.fileService.remove(stored.key);
      this.logger.warn(
        `doc upload failed kb=${kbId} file=${file.originalname}: ${err instanceof Error ? err.message : String(err)}`,
        KnowledgeDocumentService.name,
      );
      if (err instanceof Error) {
        throw new UnprocessableEntityException('文档解析失败');
      }
      throw err;
    }
    this.logger.log(
      `doc upload kb=${kbId} doc=${doc.id}`,
      KnowledgeDocumentService.name,
    );
    return toDocumentDetail(doc);
  }

  /**
   * 游标分页查询某知识库下的文档。
   * 按**不可变**的 (created_at, id) 降序做 keyset 分页；
   * 可按 `keyword` 模糊匹配标题或解析出的纯文本。
   * 排序与过滤均直接使用原始列，谓词为行比较，可走索引。
   *
   * 列表**不返回 `content`**（解析出的全文，可达 MB 级）：查询做显式列投影，
   * 返回前经 `toDocumentListItem` 收敛成列表项契约，`content` 只由详情接口给出。
   * @throws NotFoundException / ForbiddenException
   */
  async listDocuments(
    userId: string,
    kbId: string,
    query: DocumentListQueryDto,
  ): Promise<DocumentListResultDto> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertReadable(kb, userId);

    const qb = this.docRepo
      .createQueryBuilder('d')
      // 显式列投影：直接把 content 挡在 SELECT 之外（keyword 对 content 的 ILIKE 仍在 WHERE 里，
      // 那是过滤、不读取整列回传），避免每页把 20 篇全文一次拉回
      .select([
        'd.id',
        'd.knowledgeBaseId',
        'd.fileId',
        'd.title',
        'd.createdAt',
        'd.updatedAt',
      ])
      .where('d.knowledgeBaseId = :kbId', { kbId });
    if (query.keyword) {
      qb.andWhere('(d.title ILIKE :kw OR d.content ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    const page = await this.paginator.fetchPage(qb, query.cursor, query.limit);
    return {
      list: page.list.map(toDocumentListItem),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * 获取文档详情（含解析文本）。
   * @throws NotFoundException / ForbiddenException
   */
  async getDocument(
    userId: string,
    kbId: string,
    id: string,
  ): Promise<KnowledgeDocumentDetailDto> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertReadable(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    return toDocumentDetail(doc);
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
    assertOwner(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    // 事务：删除文档 + 关联文件记录，保证原子性
    await this.dataSource.transaction(async (manager) => {
      const docRepoTx = manager.getRepository(KnowledgeDocument);
      const fileRepo = manager.getRepository(BackendFileEntity);

      await docRepoTx.delete({ id, knowledgeBaseId: kbId });
      const file = await fileRepo.findOneBy({ id: doc.fileId });
      if (file) await this.fileService.remove(file.key);
      await fileRepo.delete({ id: doc.fileId });
    });
    this.logger.log(
      `doc remove kb=${kbId} doc=${id}`,
      KnowledgeDocumentService.name,
    );
    return null;
  }
}
