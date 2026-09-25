import {
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_CONTENT_MIN_LENGTH,
  MODEL_NAME_MAX_LENGTH,
} from '@lucy/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    description: '用户消息内容',
    example: '你好',
    minLength: MESSAGE_CONTENT_MIN_LENGTH,
    maxLength: MESSAGE_CONTENT_MAX_LENGTH,
  })
  @IsString()
  @MinLength(MESSAGE_CONTENT_MIN_LENGTH)
  @MaxLength(MESSAGE_CONTENT_MAX_LENGTH)
  content: string;

  @ApiPropertyOptional({
    description: '本次请求模型覆盖',
    example: 'qwen2.5:7b',
    maxLength: MODEL_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MODEL_NAME_MAX_LENGTH)
  model?: string;

  @ApiPropertyOptional({
    description: '是否开启深度思考（仅支持推理模型）',
  })
  @IsOptional()
  @IsBoolean()
  reasoning?: boolean;
}
