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
import { User } from '../../users/user.entity.js';

export enum KnowledgeBaseVisibility {
  Private = 'private',
  Public = 'public',
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

  @ApiProperty({ description: '描述', type: 'string', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string | null;

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
  // 同上，必须与 created_at 的精度保持一致
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
