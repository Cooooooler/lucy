import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({ description: '会话默认模型', example: 'qwen2.5:7b' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
