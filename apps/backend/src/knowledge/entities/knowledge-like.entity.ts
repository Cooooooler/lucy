import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/user.entity.js';
import { KnowledgeBase } from './knowledge-base.entity.js';

/**
 * 知识库点赞记录：用户-知识库多对多关系，UNIQUE 约束保证幂等。
 *
 * 纯内部表——点赞对外只有 `{ likeCount, isLiked }` 这种聚合结果（见 KnowledgeService.like），
 * 实体本身从不出现在任何响应里。因此**所有字段**都标 `@Exclude()`：出网集合为空，
 * 「不让它出网」从注释承诺变成运行时事实（由 entity-serialization.spec.ts 的出网白名单把关）。
 */
@Entity('knowledge_likes')
@Unique('UQ_knowledge_like', ['knowledgeBaseId', 'userId'])
@Index('IDX_knowledge_like_kb', ['knowledgeBaseId'])
export class KnowledgeLike {
  @ApiHideProperty()
  @Exclude()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ApiHideProperty()
  // 关系对象：@ApiHideProperty 只管 Swagger，出网与否由全局序列化拦截器依据
  // @Exclude 决定（排除式）——populate 后未标注的话，被关联实体会整体泄出。
  @Exclude()
  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'knowledge_base_id',
    foreignKeyConstraintName: 'FK_knowledge_likes_kb',
  })
  knowledgeBase?: KnowledgeBase;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ApiHideProperty()
  // 同上：User 实体带 passwordHash，populate 后会随嵌套对象一起出网
  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_knowledge_likes_user',
  })
  user?: User;

  @ApiHideProperty()
  @Exclude()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
