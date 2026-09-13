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
 * `IDX_knowledge_documents_kb_created_id` 取代。
 *
 * 注意：迁移 DDL 建的排序方向是 `created_at DESC, id DESC`（keyset 排序所需），
 * 而 `@Index` 装饰器只能表达 ASC —— `migration:generate` 可能据此提出一个 ASC
 * 版本的索引变更，**人工审查时必须拒绝**，不要让它覆盖迁移里的 DDL。
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
}
