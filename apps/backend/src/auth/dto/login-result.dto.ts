import { ApiProperty } from '@nestjs/swagger';
import { UserListItemDto } from '../../users/dto/user-list-result.dto.js';

export class LoginResultDto {
  @ApiProperty({ description: '短效访问令牌' })
  accessToken: string;

  // 用允许式契约 DTO 而非持久化实体：登录返回的是 toSharedUser 映射后的 8 字段视图，
  // 实体作为 Swagger 类型会把它标注成含 passwordHash 的 `User`，与实际响应不符。
  @ApiProperty({ description: '当前用户信息', type: UserListItemDto })
  user: UserListItemDto;
}
