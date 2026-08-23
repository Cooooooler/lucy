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

/** 文件元数据：字节交 @coool/file-nest 的 StorageDriver，此处只存描述信息并关联属主用户 */
@Entity('files')
export class BackendFileEntity {
  @ApiProperty({ description: '文件 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '文件属主用户 ID' })
  @Index('IDX_files_owner')
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_files_owner',
  })
  owner?: User;

  @ApiProperty({ description: '原始文件名' })
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @ApiProperty({ description: '扩展名（含点，如 .pdf）' })
  @Column({ type: 'varchar', length: 20 })
  ext: string;

  @ApiProperty({ description: 'MIME 类型' })
  @Column({ type: 'varchar', length: 100 })
  mime: string;

  @ApiProperty({ description: '文件大小（字节）' })
  @Column({ type: 'int' })
  size: number;

  @ApiProperty({ description: '存储相对路径 key' })
  @Column({ type: 'varchar', length: 255 })
  key: string;

  @ApiProperty({ description: 'SHA-256 校验和' })
  @Column({ type: 'char', length: 64 })
  hash: string;

  @ApiProperty({ description: '存储驱动标识', default: 'local' })
  @Column({ type: 'varchar', length: 20, default: 'local' })
  storage: string;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
