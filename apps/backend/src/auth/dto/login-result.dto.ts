import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/user.entity.js';

export class LoginResultDto {
  @ApiProperty({ description: '短效访问令牌' })
  accessToken: string;

  @ApiProperty({ description: '当前用户信息', type: User })
  user: User;
}
