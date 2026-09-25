import {
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_TITLE_MIN_LENGTH,
} from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameConversationDto {
  // 上界与前端重命名输入框共用同一常量（前端此前写 100，51–100 字符必然被后端 400）
  @ApiProperty({
    description: '新标题',
    minLength: CONVERSATION_TITLE_MIN_LENGTH,
    maxLength: CONVERSATION_TITLE_MAX_LENGTH,
  })
  @IsString()
  @MinLength(CONVERSATION_TITLE_MIN_LENGTH)
  @MaxLength(CONVERSATION_TITLE_MAX_LENGTH)
  title: string;
}
