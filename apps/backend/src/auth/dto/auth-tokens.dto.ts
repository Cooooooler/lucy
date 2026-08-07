import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensDto {
  @ApiProperty({
    description: '访问令牌（JWT）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: '刷新令牌', example: 'MTIzNDU2Nzg5MGFiY2RlZg' })
  refreshToken: string;
}
