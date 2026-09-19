import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../common/roles.js';

/** 用户账号：username/email 全局唯一，status=1 为正常；passwordHash 经 @Exclude 不出网 */
@Entity('users')
@Unique(['username'])
@Unique(['email'])
export class User {
  @ApiProperty({ description: '用户 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '用户名', example: 'lucy' })
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  // passwordHash 不加 @ApiProperty：@ApiHideProperty 只管 Swagger 文档，
  // 真正决定它是否出网的是全局 ClassSerializerInterceptor 读取的 @Exclude——
  // 它是**排除式**的，只剔除被显式标注的字段，漏标即随任意响应出网。
  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @ApiProperty({
    description: '昵称',
    type: String,
    nullable: true,
    example: 'Lucy',
  })
  @Column({ type: 'varchar', length: 50, nullable: true })
  nickname: string | null;

  @ApiProperty({ description: '状态：1 正常', example: 1 })
  @Column({ type: 'smallint', default: 1 })
  status: number;

  @ApiProperty({
    description: '角色：user 普通用户，admin 管理员，superadmin 超级管理员',
    enum: UserRole,
    default: UserRole.User,
  })
  @Column({ type: 'varchar', length: 20, default: UserRole.User })
  role: UserRole;

  @ApiProperty({ description: '创建时间', example: '2026-08-08T00:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间', example: '2026-08-08T00:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
