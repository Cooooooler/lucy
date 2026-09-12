import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/roles.js';
import type { SharedUser } from '../user.mapper.js';

/**
 * 用户列表项：与 user.mapper.ts 的 SharedUser 对齐的 8 个对外字段。
 * 不直接复用持久化实体 User：实体含 passwordHash 且 createdAt 为 Date，
 * 而对外契约已剔除敏感字段且时间为 ISO 字符串；独立 DTO 使两者漂移时
 * 在编译期/Swagger 生成期即暴露，而非静默纳入新敏感字段。
 * role 用字符串联合而非 UserRole 枚举：SharedUser['role'] 即此联合，
 * 用枚举会导致 service 返回值与 DTO 类型不互认（TS2322）。
 */
export class UserListItemDto implements SharedUser {
  @ApiProperty({ description: '用户 ID' })
  id: string;

  @ApiProperty({ description: '用户名', example: 'lucy' })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  email: string;

  @ApiProperty({ description: '昵称', type: String, nullable: true })
  nickname: string | null;

  @ApiProperty({ description: '状态：1 正常，0 禁用', example: 1 })
  status: number;

  @ApiProperty({
    description: '角色：user 普通用户，admin 管理员，superadmin 超级管理员',
    enum: UserRole,
  })
  role: SharedUser['role'];

  @ApiProperty({
    description: '创建时间',
    example: '2026-08-08T00:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '更新时间',
    example: '2026-08-08T00:00:00.000Z',
  })
  updatedAt: string;
}

export class UserListResultDto {
  @ApiProperty({ description: '用户列表', type: [UserListItemDto] })
  list: UserListItemDto[];

  @ApiProperty({ description: '总条数', example: 0 })
  total: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize: number;
}
