import { ApiProperty } from '@nestjs/swagger';
import { User } from '../user.entity.js';

export class UserListResultDto {
  @ApiProperty({ description: '用户列表', type: [User] })
  list: User[];

  @ApiProperty({ description: '总条数', example: 0 })
  total: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize: number;
}
