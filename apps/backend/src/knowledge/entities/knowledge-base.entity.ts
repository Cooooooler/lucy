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
 * 索引与迁移对齐（`src/db/migrations/*AlignKnowledgeTimestamps*`）：
 * 后两条服务于 keyset 分页 `(owner_id = :uid OR visibility = 'public')`
 * 且 `ORDER BY created_at DESC, id DESC` 的两种分支。
 *
 * 注意：迁移 DDL 建的排序方向是 `created_at DESC, id DESC`（keyset 排序所需），
 * 而 `@Index` 装饰器只能表达 ASC —— `migration:generate` 可能据此提出一个 ASC
 * 版本的索引变更，**人工审查时必须拒绝**，不要让它覆盖迁移里的 DDL。
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
  // default 必须与迁移 AlignKnowledgeTimestamps 的 DDL 逐字一致（毫秒对齐）：
  // 省略它时 TypeORM 元数据默认是 now()，migration:generate 会提出
  // `SET DEFAULT now()`，把微秒精度放回 created_at，进而让毫秒精度游标的
  // keyset 谓词 `(created_at, id) < (:cursorTs, :cursorId)` 整批跳行。
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  // 同上：default 与迁移 DDL 保持一致，避免 migration:generate 回退成 now()。
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  updatedAt: Date;

  @ApiProperty({ description: '点赞数', required: false })
  likeCount?: number;

  @ApiProperty({ description: '当前用户是否已点赞', required: false })
  isLiked?: boolean;
}
