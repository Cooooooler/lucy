import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ModelProvider } from '../../model-provider/entities/model-provider.entity.js';
import { User } from '../../users/user.entity.js';

export enum KnowledgeBaseVisibility {
  Private = 'private',
  Public = 'public',
}

/**
 * 检索模式：决定检索链路如何组合关键词与语义召回。
 * - `fulltext`：仅全文（关键词）召回
 * - `vector`：仅向量（语义）召回
 * - `hybrid`：两者混合，权重由 `semanticWeight` 表达（关键词权重 = 100 - 语义权重）
 */
export enum KnowledgeRetrievalMode {
  FullText = 'fulltext',
  Vector = 'vector',
  Hybrid = 'hybrid',
}

/**
 * 索引由下面的 `@Index` 声明——**实体是 schema 的唯一来源**，迁移由 `migration:generate`
 * 从实体产出（改这里 → 生成迁移 → `db:migrate`），不手写 DDL。
 *
 * 后两条服务的是**过滤后**的两种查询——`visibility = 'public'` 走
 * `IDX_knowledge_bases_visibility_created_id`，属主维度（`owner_id = :uid`）走
 * `IDX_knowledge_bases_owner_created_id`，两者都能拿到 `(created_at DESC, id DESC)` 的有序扫描。
 * `@Index` 只能表达 ASC，但 keyset 的降序排序由 Postgres 的**反向索引扫描**满足
 * （实测两条查询都是 `Index Only Scan Backward`），无需把索引建成 DESC。
 *
 * ⚠️ 默认分支 `(owner_id = :uid OR visibility = 'public')` **不属于**这两种情况：两个 OR 分支的
 * 前导列不同，任何单个 btree 都无法同时提供该排序，规划器只能 BitmapOr/顺序扫描后再排序
 * （`LIMIT` 之前要把匹配集排完）。公开库规模变大后这条最常用路径会退化，届时应拆成
 * `UNION ALL` 的两个分支各自 `LIMIT` 再按 `(created_at, id)` 归并，而不是指望现有索引。
 */
@Entity('knowledge_bases')
@Index('IDX_knowledge_bases_owner_visibility', ['ownerId', 'visibility'])
@Index('IDX_knowledge_bases_owner_created_id', ['ownerId', 'createdAt', 'id'])
@Index('IDX_knowledge_bases_visibility_created_id', [
  'visibility',
  'createdAt',
  'id',
])
// rerank_model_id 的 FK 需自带索引：删除模型时 ON DELETE SET NULL 会按该列定位引用行，
// 无索引则退化为全表扫描（TypeORM 不会为 FK 列自动建索引）
@Index('IDX_knowledge_bases_rerank_model', ['rerankModelId'])
export class KnowledgeBase {
  @ApiProperty({ description: '知识库 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '属主用户 ID' })
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiHideProperty()
  // 内部关系对象，不对外暴露：全局 ClassSerializerInterceptor（CommonModule）据 @Exclude 剔除。
  // 实体的其它字段即对外契约——新增内部/敏感字段时务必同步加 @Exclude()，否则会进入真实响应与 Swagger 契约。
  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_knowledge_bases_owner',
  })
  owner?: User;

  @ApiProperty({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: KnowledgeBaseVisibility.Private,
  })
  @Column({
    type: 'varchar',
    length: 10,
    default: KnowledgeBaseVisibility.Private,
  })
  visibility: KnowledgeBaseVisibility;

  @ApiProperty({ description: '名称' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ description: '描述', type: 'string' })
  @Column({ type: 'varchar', length: 200 })
  description: string;

  // ---- 检索设置：仅在创建时确定，之后只读（更新 DTO 不声明这些字段）----
  // 默认值字面量与 `@lucy/shared` 的 KNOWLEDGE_*_DEFAULT 常量对齐；此处写字面量是为了让
  // `migration:generate` 产出稳定的 DDL，不依赖 shared 的构建产物。

  // 检索字段的契约由 KnowledgeBaseItemDto / CreateKnowledgeBaseDto 定义，
  // 实体只负责 schema；这里不再维护第二份 Swagger 描述（会与 DTO 漂移）。
  @ApiHideProperty()
  @Column({
    name: 'retrieval_mode',
    type: 'varchar',
    length: 10,
    default: KnowledgeRetrievalMode.FullText,
  })
  retrievalMode: KnowledgeRetrievalMode;

  // 数值边界由 `@lucy/shared` 常量 + 允许式 DTO 定义，实体不是对外契约：
  // 在这里写死区间文案只会在常量调整时静默失准，故不参与 Swagger。
  @ApiHideProperty()
  @Column({ name: 'top_k', type: 'int', default: 5 })
  topK: number;

  @ApiHideProperty()
  @Column({ name: 'score_threshold_enabled', type: 'boolean', default: false })
  scoreThresholdEnabled: boolean;

  @ApiHideProperty()
  @Column({ name: 'score_threshold', type: 'real', default: 0 })
  scoreThreshold: number;

  @ApiHideProperty()
  @Column({ name: 'semantic_weight', type: 'int', default: 50 })
  semanticWeight: number;

  @ApiHideProperty()
  // 自有列声明关系：服务层读写只碰 id，不 populate 关系（契约里也只有 id）
  @Column({ name: 'rerank_model_id', type: 'uuid', nullable: true })
  rerankModelId: string | null;

  @ApiHideProperty()
  // 关系对象不对外暴露（@Exclude 由全局序列化拦截器生效）。
  // ON DELETE SET NULL：删除模型时只断开关联，不连带删除知识库。
  @Exclude()
  @ManyToOne(() => ModelProvider, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'rerank_model_id',
    foreignKeyConstraintName: 'FK_knowledge_bases_rerank_model',
  })
  rerankModel?: ModelProvider;

  @ApiProperty({ description: '创建时间' })
  // 毫秒对齐：keyset 游标是毫秒精度（JS Date 的固有精度），列默认值若落到微秒，
  // `(created_at, id) < (:cursorTs, :cursorId)` 会在同一毫秒内整批跳行。
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  // 插入时的列默认值与 created_at 一样按毫秒对齐；但 UPDATE 路径（`repository.update`，
  // 包括 `save` 之外的列级更新与跨领域清理）由 TypeORM 写 `CURRENT_TIMESTAMP`，
  // Postgres 精度是**微秒**。因此 updated_at **不得**用作 keyset/增量游标
  // （同一毫秒内的多行会被整批跳过）；排序/游标一律用不可变的 created_at。
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  updatedAt: Date;

  // 查询期计算的视图字段（非持久化列，见 KnowledgeService.fillLikeInfo）：
  // 对外契约由 KnowledgeBaseItemDto 定义，这里不参与 Swagger，也不靠序列化拦截器兜底。
  @ApiHideProperty()
  likeCount?: number;

  @ApiHideProperty()
  isLiked?: boolean;
}
