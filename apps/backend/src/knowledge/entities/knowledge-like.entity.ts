import { ApiHideProperty } from '@nestjs/swagger';
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

/** 知识库点赞记录：用户-知识库多对多关系，UNIQUE 约束保证幂等 */
@Entity('knowledge_likes')
@Unique('UQ_knowledge_like', ['knowledgeBaseId', 'userId'])
@Index('IDX_knowledge_like_kb', ['knowledgeBaseId'])
export class KnowledgeLike {
  @ApiHideProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiHideProperty()
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ApiHideProperty()
  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'knowledge_base_id',
    foreignKeyConstraintName: 'FK_knowledge_likes_kb',
  })
  knowledgeBase?: KnowledgeBase;

  @ApiHideProperty()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_knowledge_likes_user',
  })
  user?: User;

  @ApiHideProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
