import { FileService } from '@coool/file-nest';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { KeysetPaginator } from '../common/pagination/keyset-paginator.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import type {
  KnowledgeBaseItemDto,
  KnowledgeListResultDto,
} from './dto/knowledge-list-result.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { assertOwner, assertReadable } from './knowledge-access.js';
import { toKnowledgeBaseItem } from './knowledge.mapper.js';

/**
 * 知识库领域服务：元信息 CRUD（create/list/get/update/remove）与点赞态（like/unlike）。
 *
 * 文档处理（上传解析/列表/详情/删除、底层文件 I/O）已拆到 `KnowledgeDocumentService`
 * （`arch-single-responsibility`）；可见性判定由 `knowledge-access.ts` 共用。
 * 点赞态由本服务回填，因为 `get/list/update` 都要附带 it，与知识库读取路径同源。
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly logger: AppLogger,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeLike)
    private readonly likeRepo: Repository<KnowledgeLike>,
    private readonly fileService: FileService,
    private readonly paginator: KeysetPaginator,
  ) {}

  /**
   * 创建一个知识库。
   * @param userId 属主用户 ID
   * @param dto 创建参数（名称必填，描述/可见性可选）
   * @returns 新知识库的对外契约视图（点赞态为空，即 likeCount=0 / isLiked=false）
   */
  async create(
    userId: string,
    dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseItemDto> {
    this.logger.log(`kb create name=${dto.name}`, KnowledgeService.name);
    const kb = await this.kbRepo.save({
      ownerId: userId,
      name: dto.name,
      description: dto.description ?? null,
      visibility: dto.visibility ?? KnowledgeBaseVisibility.Private,
    });
    return toKnowledgeBaseItem(kb);
  }

  /**
   * 游标分页查询知识库列表。
   * 默认返回当前用户拥有的 + 公开的知识库；可按 `visibility` / 名称关键字过滤。
   * 按**不可变**的 (created_at, id) 降序做 keyset 分页。刻意不用 updated_at：
   * 它是可变排序键，上页取出之后被更新的行会越过游标，从而在后续页被永久漏掉。
   * 并列（同一毫秒内插入、或同一事务批量插入）由 id 决胜，排序仍是全序。
   * 排序与过滤均直接使用原始列（实体默认值保证时间列毫秒对齐），谓词写成行比较
   * `(created_at, id) < (:cursorTs, :cursorId)`，Postgres 可将其优化为一次索引扫描。
   * 附加每个知识库的 likeCount 与当前用户的 isLiked（查询后批量回写，避免 JOIN 破坏分页）。
   * @param userId 当前用户 ID
   * @param query 游标与过滤参数
   * @returns list 与下一页游标（null 表示已到底，list 元素为对外契约视图）
   */
  async list(
    userId: string,
    query: KnowledgeListQueryDto,
  ): Promise<KnowledgeListResultDto> {
    const qb = this.kbRepo.createQueryBuilder('kb');
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
    const page = await this.paginator.fetchPage(qb, query.cursor, query.limit);
    // 批量回写 likeCount / isLiked，单次聚合查询，避免 N+1
    await this.fillLikeInfo(userId, page.list);
    return {
      list: page.list.map(toKnowledgeBaseItem),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * 获取知识库详情。
   * @throws NotFoundException 知识库不存在
   * @throws ForbiddenException 用户无权访问（既非属主，也非公开）
   */
  async get(userId: string, id: string): Promise<KnowledgeBaseItemDto> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertReadable(kb, userId);
    await this.fillLikeInfo(userId, [kb]);
    return toKnowledgeBaseItem(kb);
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
    assertReadable(kb, userId);
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
    assertReadable(kb, userId);
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
  ): Promise<KnowledgeBaseItemDto> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertOwner(kb, userId);
    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description;
    if (dto.visibility !== undefined) kb.visibility = dto.visibility;
    const saved = await this.kbRepo.save(kb);
    // 点赞态同样要回填：响应形状必须与 get/list 完全一致，
    // 否则 mapper 的兜底会把「已点赞」谎报成 0/false。
    await this.fillLikeInfo(userId, [saved]);
    this.logger.log(`kb update kb=${id}`, KnowledgeService.name);
    return toKnowledgeBaseItem(saved);
  }

  /**
   * 删除知识库（级联清空其下所有文档与底层文件）。
   * @throws NotFoundException / ForbiddenException
   */
  async remove(userId: string, id: string): Promise<null> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    assertOwner(kb, userId);
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
}
