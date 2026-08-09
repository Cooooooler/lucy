import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ description: '用户消息内容', example: '你好' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({
    description: '本次请求模型覆盖',
    example: 'qwen2.5:7b',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
