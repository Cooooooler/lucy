import { MODEL_NAME_MAX_LENGTH } from '@lucy/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({
    description: '会话默认模型',
    example: 'qwen2.5:7b',
    maxLength: MODEL_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MODEL_NAME_MAX_LENGTH)
  model?: string;
}
