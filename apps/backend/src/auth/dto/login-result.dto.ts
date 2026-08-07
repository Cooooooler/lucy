import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/user.entity.js';
import { AuthTokensDto } from './auth-tokens.dto.js';

export class LoginResultDto extends AuthTokensDto {
  @ApiProperty({ description: '当前用户信息', type: User })
  user: User;
}
