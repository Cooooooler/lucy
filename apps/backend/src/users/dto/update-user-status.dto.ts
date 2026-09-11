import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({
    description: '状态：1 正常，0 禁用',
    enum: [1, 0],
    example: 1,
  })
  @IsInt()
  @IsIn([0, 1])
  status: number;
}
