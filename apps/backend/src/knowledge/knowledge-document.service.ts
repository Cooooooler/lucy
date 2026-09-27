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
import { DataSource, In, Repository } from 'typeorm';
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
import { resolveOwnedKb, resolveReadableKb } from './knowledge-access.js';
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
    await resolveOwnedKb(this.kbRepo, kbId, userId);

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

    // 解析放在事务外并单独 catch：只有「解析失败」才是内容不可处理（422）；
    // DB 约束/连接等基础设施故障不应被误报成 422，下面原样上抛。
    let content: string;
    try {
      content = await extractContent(file.buffer, origExt);
    } catch (err) {
      await this.removeStoredQuietly([stored.key]);
      this.logger.warn(
        `doc parse failed kb=${kbId} file=${file.originalname}: ${err instanceof Error ? err.message : String(err)}`,
        KnowledgeDocumentService.name,
      );
      throw new UnprocessableEntityException('文档解析失败');
    }
    const title = basename(file.originalname, extname(file.originalname));

    // 事务只做 DB 写入（文件记录 + 文档记录），不含外部存储 I/O
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

        return docRepo.save({
          knowledgeBaseId: kbId,
          fileId: fileEntity.id,
          title,
          content,
        });
      });
    } catch (err) {
      // DB 失败：清理已上传的底层文件（best-effort），原始错误原样上抛
      await this.removeStoredQuietly([stored.key]);
      this.logger.warn(
        `doc upload failed kb=${kbId} file=${file.originalname}: ${err instanceof Error ? err.message : String(err)}`,
        KnowledgeDocumentService.name,
      );
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
    await resolveReadableKb(this.kbRepo, kbId, userId);

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
    await resolveReadableKb(this.kbRepo, kbId, userId);
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
    await resolveOwnedKb(this.kbRepo, kbId, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    // 事务内只做 DB 删除并取回待清理的存储 key；底层对象在**提交后** best-effort 清理。
    // 外部存储 I/O 回滚不了：若留在事务内，后续步骤失败时会留下「行回滚了、文件已删」的脏行。
    const key = await this.dataSource.transaction(async (manager) => {
      const docRepoTx = manager.getRepository(KnowledgeDocument);
      const fileRepo = manager.getRepository(BackendFileEntity);

      await docRepoTx.delete({ id, knowledgeBaseId: kbId });
      const file = await fileRepo.findOneBy({ id: doc.fileId });
      await fileRepo.delete({ id: doc.fileId });
      return file?.key ?? null;
    });
    if (key) await this.removeStoredQuietly([key]);
    this.logger.log(
      `doc remove kb=${kbId} doc=${id}`,
      KnowledgeDocumentService.name,
    );
    return null;
  }

  /**
   * 级联删除某知识库及其全部文档、文件记录与底层文件（知识库级联清理的**唯一入口**）。
   *
   * 由知识库服务在校验属主后调用；事务与文件清理都收在这里，调用方不必接触 EntityManager，
   * 也不会拿到一个「无鉴权、可被任意调用方以任意 kbId 触发」的公开方法。
   *
   * - DB 删除放在**单个事务**里（文档行 + 文件行 + 知识库行），保持原子性；
   * - 取文档时只 select `id`/`fileId`：删除路径不需要 `content`（`text`，可达 MB 级），
   *   否则删一个含 N 篇文档的库等于把整库全文读进内存；
   * - 底层文件 I/O 回滚不了，放在**提交后** best-effort 清理，失败仅告警。
   */
  async removeAllForKnowledgeBase(kbId: string): Promise<void> {
    const keys = await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(KnowledgeDocument);
      const fileRepo = manager.getRepository(BackendFileEntity);
      const kbRepo = manager.getRepository(KnowledgeBase);

      const docs = await docRepo.find({
        where: { knowledgeBaseId: kbId },
        select: { id: true, fileId: true },
      });
      const fileIds = docs.map((d) => d.fileId);
      const files = fileIds.length
        ? await fileRepo.findBy({ id: In(fileIds) })
        : [];
      if (fileIds.length) await fileRepo.delete({ id: In(fileIds) });
      await docRepo.delete({ knowledgeBaseId: kbId });
      await kbRepo.delete({ id: kbId });
      return files.map((f) => f.key);
    });
    await this.removeStoredQuietly(keys);
  }

  /** best-effort 清理底层文件：失败仅告警，绝不顶替调用方的原始错误。 */
  private async removeStoredQuietly(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.fileService.remove(key);
      } catch (err) {
        this.logger.warn(
          `删除底层文件失败 key=${key}: ${err instanceof Error ? err.message : String(err)}`,
          KnowledgeDocumentService.name,
        );
      }
    }
  }
}
