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
import { BackendFileEntity } from './backend-file.entity.js';
import { KnowledgeBase } from './knowledge-base.entity.js';

/**
 * 索引与迁移对齐（`src/db/migrations/*AlignKnowledgeTimestamps*`）：
 * `IDX_knowledge_documents_kb_created`（缺 id 决胜列）已由
 * `IDX_knowledge_documents_kb_created_id` 取代；`@Index` 装饰器无法表达列的
 * DESC 方向，实际排序方向以迁移里的 DDL 为准。
 */
@Entity('knowledge_documents')
@Index('IDX_knowledge_documents_kb_created_id', [
  'knowledgeBaseId',
  'createdAt',
  'id',
])
export class KnowledgeDocument {
  @ApiProperty({ description: '文档 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  @Index('IDX_knowledge_documents_kb')
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  @Index('IDX_knowledge_documents_file')
  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  @ApiHideProperty()
  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'knowledge_base_id',
    foreignKeyConstraintName: 'FK_knowledge_documents_kb',
  })
  knowledgeBase?: KnowledgeBase;

  @ApiHideProperty()
  @ManyToOne(() => BackendFileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'file_id',
    foreignKeyConstraintName: 'FK_knowledge_documents_file',
  })
  file?: BackendFileEntity;

  @ApiProperty({ description: '标题' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty({
    description: '解析出的纯文本',
    type: 'string',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
