import {
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_CONTENT_MIN_LENGTH,
} from '@lucy/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
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
    description: '本次请求使用的模型配置 ID（省略则用会话默认模型）',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  modelProviderId?: string;

  @ApiPropertyOptional({
    description: '是否开启深度思考（仅支持推理模型）',
  })
  @IsOptional()
  @IsBoolean()
  reasoning?: boolean;
}
