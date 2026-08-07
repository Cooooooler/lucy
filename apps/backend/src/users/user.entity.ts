import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
@Unique(['username'])
@Unique(['email'])
export class User {
  @ApiProperty({ description: '用户 ID' })
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ApiProperty({ description: '用户名', example: 'lucy' })
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  // passwordHash 不加 @ApiProperty
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @ApiProperty({ description: '昵称', nullable: true, example: 'Lucy' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  nickname: string | null;

  @ApiProperty({ description: '状态：1 正常', example: 1 })
  @Column({ type: 'smallint', default: 1 })
  status: number;

  @ApiProperty({ description: '创建时间', example: '2026-08-08T00:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间', example: '2026-08-08T00:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // deletedAt 不加 @ApiProperty
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
