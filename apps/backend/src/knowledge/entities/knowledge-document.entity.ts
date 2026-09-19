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
import { BackendFileEntity } from './backend-file.entity.js';
import { KnowledgeBase } from './knowledge-base.entity.js';

/**
 * 索引由下面的 `@Index` 声明——**实体是 schema 的唯一来源**，迁移由 `migration:generate`
 * 从实体产出（改这里 → 生成迁移 → `db:migrate`），不手写 DDL。
 *
 * `(knowledge_base_id, created_at, id)` 同时服务知识库维度下的 keyset 分页：
 * `@Index` 只能表达 ASC，但 `ORDER BY created_at DESC, id DESC` 由 Postgres 的
 * 反向索引扫描满足（与 knowledge_bases 的索引同理），无需建成 DESC。
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
  // 不再单独建 (knowledge_base_id) 索引：已被下面的复合索引前导列完全覆盖（含 FK 级联删除），
  // 单列索引属冗余，白付写放大（synchronize 也不会建它：实体上没有声明）
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  @Index('IDX_knowledge_documents_file')
  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  @ApiHideProperty()
  // 内部关系对象，不对外暴露：全局 ClassSerializerInterceptor（CommonModule）据 @Exclude 剔除。
  // 实体的其它字段即对外契约——新增内部/敏感字段时务必同步加 @Exclude()，否则会进入真实响应与 Swagger 契约。
  @Exclude()
  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'knowledge_base_id',
    foreignKeyConstraintName: 'FK_knowledge_documents_kb',
  })
  knowledgeBase?: KnowledgeBase;

  @ApiHideProperty()
  // 同上：文件实体（含存储 key/hash 等）不对外暴露，由全局序列化拦截器据 @Exclude 剔除。
  @Exclude()
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
}
