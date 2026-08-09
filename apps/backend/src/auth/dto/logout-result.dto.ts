import { ApiProperty } from '@nestjs/swagger';

export class LogoutResultDto {
  @ApiProperty({ description: '是否登出成功', example: true })
  success: boolean;
}
