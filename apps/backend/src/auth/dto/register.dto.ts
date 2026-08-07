import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: '用户名，仅支持字母数字下划线连字符',
    example: 'lucy',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'lucy@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: '密码（8-72 位）',
    example: 'Password1!',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @Length(8, 72)
  password: string;

  @ApiPropertyOptional({ description: '昵称', example: 'Lucy' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;
}
