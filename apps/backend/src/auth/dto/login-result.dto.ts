import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/user.entity.js';

export class LoginResultDto {
  @ApiProperty({
    description: '访问令牌（JWT）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: '刷新令牌', example: 'MTIzNDU2Nzg5MGFiY2RlZg' })
  refreshToken: string;

  @ApiProperty({ description: '当前用户信息', type: User })
  user: User;
}
