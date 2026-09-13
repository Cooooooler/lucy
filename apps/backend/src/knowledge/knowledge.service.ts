import { FileService } from '@coool/file-nest';
import {
  ConflictException,
  ForbiddenException,
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
import {
  extractContent,
  SUPPORTED_DOCUMENT_EXTS,
} from './content-extractor.js';
import { decodeCursor, encodeCursor } from './cursor.js';
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
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { detectFileType } from './magic-bytes.js';

/** 游标分页默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly logger: AppLogger,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeLike)
    private readonly likeRepo: Repository<KnowledgeLike>,
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
    this.logger.log(`kb create name=${dto.name}`, KnowledgeService.name);
    return this.kbRepo.save({
      ownerId: userId,
      name: dto.name,
      description: dto.description ?? null,
      visibility: dto.visibility ?? KnowledgeBaseVisibility.Private,
    });
  }

  /**
   * 游标分页查询知识库列表。
   * 默认返回当前用户拥有的 + 公开的知识库；可按 `visibility` / 名称关键字过滤。
   * 按**不可变**的 (created_at, id) 降序做 keyset 分页。刻意不用 updated_at：
   * 它是可变排序键，上页取出之后被更新的行会越过游标，从而在后续页被永久漏掉。
   * 并列（同一毫秒内插入、或同一事务批量插入）由 id 决胜，排序仍是全序。
   * 排序与过滤均直接使用原始列（迁移保证时间列毫秒对齐），谓词写成行比较
   * `(created_at, id) < (:cursorTs, :cursorId)`，Postgres 可将其优化为一次索引扫描。
   * 附加每个知识库的 likeCount 与当前用户的 isLiked（查询后批量回写，避免 JOIN 破坏分页）。
   * @param userId 当前用户 ID
   * @param query 游标与过滤参数
   * @returns list 与下一页游标（null 表示已到底，list 含 likeCount/isLiked）
   */
  async list(
    userId: string,
    query: KnowledgeListQueryDto,
  ): Promise<{ list: KnowledgeBase[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const qb = this.kbRepo
      .createQueryBuilder('kb')
      .orderBy('kb.created_at', 'DESC')
      .addOrderBy('kb.id', 'DESC');
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
    if (query.cursor) {
      const { timestamp, id } = decodeCursor(query.cursor);
      qb.andWhere('(kb.created_at, kb.id) < (:cursorTs, :cursorId)', {
        cursorTs: timestamp,
        cursorId: id,
      });
    }
    const rows = await qb.take(limit + 1).getMany();
    const page = this.toCursorPage(rows, limit, (kb) =>
      encodeCursor(kb.createdAt, kb.id),
    );
    // 批量回写 likeCount / isLiked，单次聚合查询，避免 N+1
    await this.fillLikeInfo(userId, page.list);
    return page;
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
    await this.fillLikeInfo(userId, [kb]);
    return kb;
  }

  /**
   * 点赞一个知识库（重复点赞抛 409）。
   * @returns 操作后的 likeCount 与 isLiked
   * @throws NotFoundException 知识库不存在
   * @throws ForbiddenException 用户无权访问
   * @throws ConflictException 已点赞
   */
  async like(
    userId: string,
    id: string,
  ): Promise<{ likeCount: number; isLiked: true }> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    const existing = await this.likeRepo.findOneBy({
      knowledgeBaseId: id,
      userId,
    });
    if (existing) throw new ConflictException('已点赞');
    try {
      await this.likeRepo.save({ knowledgeBaseId: id, userId });
    } catch (err) {
      // 并发竞态：两个请求同时通过 findOneBy 校验后，save 触发 UNIQUE 约束冲突
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('已点赞');
      }
      throw err;
    }
    const likeCount = await this.likeRepo.count({
      where: { knowledgeBaseId: id },
    });
    return { likeCount, isLiked: true };
  }

  /**
   * 取消点赞一个知识库（未点赞时静默成功）。
   * @returns 操作后的 likeCount 与 isLiked
   * @throws NotFoundException 知识库不存在
   * @throws ForbiddenException 用户无权访问
   */
  async unlike(
    userId: string,
    id: string,
  ): Promise<{ likeCount: number; isLiked: false }> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    await this.likeRepo.delete({ knowledgeBaseId: id, userId });
    const likeCount = await this.likeRepo.count({
      where: { knowledgeBaseId: id },
    });
    return { likeCount, isLiked: false };
  }

  /**
   * 批量回写知识库的 likeCount 与 isLiked。
   * 单条聚合 GROUP BY 查询计数 + 单条查询当前用户点赞集合，避免 N+1。
   */
  private async fillLikeInfo(
    userId: string,
    list: KnowledgeBase[],
  ): Promise<void> {
    if (list.length === 0) return;
    const ids = list.map((kb) => kb.id);
    // 计数：GROUP BY knowledge_base_id
    const counts = await this.likeRepo
      .createQueryBuilder('kl')
      .select('kl.knowledge_base_id', 'kbId')
      .addSelect('COUNT(*)', 'cnt')
      .where('kl.knowledge_base_id IN (:...ids)', { ids })
      .groupBy('kl.knowledge_base_id')
      .getRawMany<{ kbId: string; cnt: string }>();
    const countMap = new Map(counts.map((r) => [r.kbId, Number(r.cnt)]));
    // 当前用户点赞集合
    const liked = await this.likeRepo
      .createQueryBuilder('kl')
      .select('kl.knowledge_base_id', 'kbId')
      .where('kl.knowledge_base_id IN (:...ids)', { ids })
      .andWhere('kl.user_id = :uid', { uid: userId })
      .getRawMany<{ kbId: string }>();
    const likedSet = new Set(liked.map((r) => r.kbId));
    for (const kb of list) {
      kb.likeCount = countMap.get(kb.id) ?? 0;
      kb.isLiked = likedSet.has(kb.id);
    }
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
    const saved = await this.kbRepo.save(kb);
    this.logger.log(`kb update kb=${id}`, KnowledgeService.name);
    return saved;
  }

  /**
   * 删除知识库（级联清空其下所有文档与底层文件）。
   * @throws NotFoundException / ForbiddenException
   */
  async remove(userId: string, id: string): Promise<null> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    // 事务：级联删除文档及其关联的文件记录，保证原子性
    await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(KnowledgeDocument);
      const fileRepo = manager.getRepository(BackendFileEntity);
      const kbRepo = manager.getRepository(KnowledgeBase);

      const docs = await docRepo.find({ where: { knowledgeBaseId: id } });
      for (const d of docs) {
        const file = await fileRepo.findOneBy({ id: d.fileId });
        if (file) {
          await this.fileService.remove(file.key);
          await fileRepo.delete({ id: file.id });
        }
      }
      await kbRepo.delete({ id });
    });
    this.logger.log(`kb remove kb=${id}`, KnowledgeService.name);
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
        KnowledgeService.name,
      );
      if (err instanceof Error) {
        throw new UnprocessableEntityException('文档解析失败');
      }
      throw err;
    }
    this.logger.log(
      `doc upload kb=${kbId} doc=${doc.id}`,
      KnowledgeService.name,
    );
    return doc;
  }

  /**
   * 游标分页查询某知识库下的文档。
   * 按**不可变**的 (created_at, id) 降序做 keyset 分页（同 list()，不使用可变的 updated_at）；
   * 可按 `keyword` 模糊匹配标题或解析出的纯文本。
   * 排序与过滤均直接使用原始列，谓词为行比较，可走索引。
   * @throws NotFoundException / ForbiddenException
   */
  async listDocuments(
    userId: string,
    kbId: string,
    query: DocumentListQueryDto,
  ): Promise<{ list: KnowledgeDocument[]; nextCursor: string | null }> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const qb = this.docRepo
      .createQueryBuilder('d')
      .where('d.knowledgeBaseId = :kbId', { kbId })
      .orderBy('d.created_at', 'DESC')
      .addOrderBy('d.id', 'DESC');
    if (query.keyword) {
      qb.andWhere('(d.title ILIKE :kw OR d.content ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.cursor) {
      const { timestamp, id } = decodeCursor(query.cursor);
      qb.andWhere('(d.created_at, d.id) < (:cursorTs, :cursorId)', {
        cursorTs: timestamp,
        cursorId: id,
      });
    }
    const rows = await qb.take(limit + 1).getMany();
    return this.toCursorPage(rows, limit, (doc) =>
      encodeCursor(doc.createdAt, doc.id),
    );
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
    // 事务：删除文档 + 关联文件记录，保证原子性
    await this.dataSource.transaction(async (manager) => {
      const docRepoTx = manager.getRepository(KnowledgeDocument);
      const fileRepo = manager.getRepository(BackendFileEntity);

      await docRepoTx.delete({ id, knowledgeBaseId: kbId });
      const file = await fileRepo.findOneBy({ id: doc.fileId });
      if (file) await this.fileService.remove(file.key);
      await fileRepo.delete({ id: doc.fileId });
    });
    this.logger.log(`doc remove kb=${kbId} doc=${id}`, KnowledgeService.name);
    return null;
  }

  /**
   * 把「多取一条」的查询结果裁成首页大小，并生成下一页游标。
   * 多取一条用于判断是否还有下一页，避免额外的 COUNT 查询。
   */
  private toCursorPage<T>(
    rows: T[],
    limit: number,
    toCursor: (row: T) => string,
  ): { list: T[]; nextCursor: string | null } {
    const hasNext = rows.length > limit;
    const list = hasNext ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasNext && list.length > 0 ? toCursor(list[list.length - 1]) : null;
    return { list, nextCursor };
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
