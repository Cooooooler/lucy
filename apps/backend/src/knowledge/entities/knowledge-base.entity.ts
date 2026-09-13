import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
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
 * 且 `ORDER BY created_at DESC, id DESC` 的两种分支；`@Index` 装饰器无法表达
 * 列的 DESC 方向，实际排序方向以迁移里的 DDL 为准。
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
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ApiProperty({ description: '点赞数', required: false })
  likeCount?: number;

  @ApiProperty({ description: '当前用户是否已点赞', required: false })
  isLiked?: boolean;
}
