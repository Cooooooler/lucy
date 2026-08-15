import { ApiProperty } from '@nestjs/swagger';

export class RefreshResultDto {
  @ApiProperty({ description: '访问令牌（短效 JWT）', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;
}
