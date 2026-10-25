import {
  KNOWLEDGE_SCORE_THRESHOLD_DEFAULT,
  KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT,
  KNOWLEDGE_TOP_K_DEFAULT,
} from '@lucy/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { escapeLikePattern } from '../common/like-pattern.js';
import { KeysetPaginator } from '../common/pagination/keyset-paginator.js';
import { ModelProviderService } from '../model-provider/model-provider.service.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import type {
  KnowledgeBaseItemDto,
  KnowledgeListResultDto,
} from './dto/knowledge-list-result.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
  KnowledgeRetrievalMode,
} from './entities/knowledge-base.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { resolveOwnedKb, resolveReadableKb } from './knowledge-access.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';
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
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeLike)
    private readonly likeRepo: Repository<KnowledgeLike>,
    private readonly paginator: KeysetPaginator,
    // 级联删除知识库时复用文档/文件的清理逻辑（底层文件 I/O 收在文档服务里）
    private readonly documentService: KnowledgeDocumentService,
    // 创建时校验所选重排模型的属主与类型（模型领域 owns 该判据）
    private readonly modelProviderService: ModelProviderService,
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
    const scoreThresholdEnabled = dto.scoreThresholdEnabled ?? false;
    const scoreThreshold =
      dto.scoreThreshold ?? KNOWLEDGE_SCORE_THRESHOLD_DEFAULT;
    // 启用阈值却为 0 等于不过滤：检索设置创建后不可改，不能在落库后才发现是空转。
    // 这里刻意判 `<= 0` 而非复用闭区间下界常量：DTO/前端允许的闭区间下界与
    // 「启用时必须严格大于」是两个语义，绑在同一常量上会出现文档放行、服务层拒绝。
    if (scoreThresholdEnabled && scoreThreshold <= 0) {
      throw new BadRequestException('启用 Score 阈值时必须设置大于 0 的阈值');
    }
    // 重排模型校验与插入必须在同一事务里：校验通过后并发删除会撞 FK（23503 → 500），
    // 并发改类型则会写入类型不符的引用；事务内的共享锁与删除/改类型互斥。
    const kb = await this.kbRepo.manager.transaction(async (manager) => {
      if (dto.rerankModelId) {
        const rerank =
          await this.modelProviderService.resolveOwnedRerankInTransaction(
            manager,
            userId,
            dto.rerankModelId,
          );
        // 两种失败原因的修复动作不同：换一个模型 vs 改模型类型，文案必须分开
        if (rerank === 'wrong-type') {
          throw new BadRequestException('该模型类型不是重排模型');
        }
        if (rerank === 'not-found') {
          throw new BadRequestException('重排模型不存在或不属于当前用户');
        }
      }
      return manager.save(KnowledgeBase, {
        ownerId: userId,
        name: dto.name,
        description: dto.description,
        visibility: dto.visibility ?? KnowledgeBaseVisibility.Private,
        // 检索设置只在创建时确定（更新 DTO 不含这些字段）
        retrievalMode: dto.retrievalMode ?? KnowledgeRetrievalMode.FullText,
        topK: dto.topK ?? KNOWLEDGE_TOP_K_DEFAULT,
        scoreThresholdEnabled,
        scoreThreshold,
        semanticWeight: dto.semanticWeight ?? KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT,
        rerankModelId: dto.rerankModelId ?? null,
      });
    });
    return toKnowledgeBaseItem(kb, userId);
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
      qb.andWhere('kb.name ILIKE :name', {
        name: `%${escapeLikePattern(query.name)}%`,
      });
    }
    const page = await this.paginator.fetchPage(qb, query.cursor, query.limit);
    // 批量回写 likeCount / isLiked，单次聚合查询，避免 N+1
    await this.fillLikeInfo(userId, page.list);
    return {
      list: page.list.map((kb) => toKnowledgeBaseItem(kb, userId)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * 获取知识库详情。
   * @throws NotFoundException 知识库不存在
   * @throws ForbiddenException 用户无权访问（既非属主，也非公开）
   */
  async get(userId: string, id: string): Promise<KnowledgeBaseItemDto> {
    const kb = await resolveReadableKb(this.kbRepo, id, userId);
    await this.fillLikeInfo(userId, [kb]);
    return toKnowledgeBaseItem(kb, userId);
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
    await resolveReadableKb(this.kbRepo, id, userId);
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
    await resolveReadableKb(this.kbRepo, id, userId);
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
   * 检索设置（模式/召回条数/阈值/权重/重排模型）有意不在此处：它们只在创建时确定。
   * @throws NotFoundException / ForbiddenException
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseItemDto> {
    const kb = await resolveOwnedKb(this.kbRepo, id, userId);
    const patch: Partial<KnowledgeBase> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    // 只写 DTO 中显式出现的列，不对整实体做 save：整实体 diff 会把读到的旧
    // rerank_model_id 与「并发改模型类型已清空」的库值比较后判为变更并写回，
    // 让刚失效的引用复活（检索设置创建后不可改，写回即无法修正）。
    let saved = kb;
    if (Object.keys(patch).length > 0) {
      await this.kbRepo.update({ id: kb.id }, patch);
      saved = await this.kbRepo.findOneByOrFail({ id: kb.id });
    }
    // 点赞态同样要回填：响应形状必须与 get/list 完全一致，
    // 否则 mapper 的兜底会把「已点赞」谎报成 0/false。
    await this.fillLikeInfo(userId, [saved]);
    this.logger.log(`kb update kb=${id}`, KnowledgeService.name);
    return toKnowledgeBaseItem(saved, userId);
  }

  /**
   * 删除知识库（级联清空其下所有文档与底层文件）。
   * @throws NotFoundException / ForbiddenException
   */
  async remove(userId: string, id: string): Promise<null> {
    // 级联清理（文档行 + 文件行 + 知识库行 + 底层文件）整体下沉到文档服务，
    // 属主校验也在该入口内完成（不再依赖调用方先校验这一约定）
    await this.documentService.removeAllForKnowledgeBase(userId, id);
    this.logger.log(`kb remove kb=${id}`, KnowledgeService.name);
    return null;
  }
}
