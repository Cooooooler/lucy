import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameConversationDto {
  @ApiProperty({ description: '新标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title: string;
}
