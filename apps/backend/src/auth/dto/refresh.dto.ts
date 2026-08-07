import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({
    description: 'refresh token，缺省时读取 HttpOnly cookie `refreshToken`',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
