import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 72)
  password: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;
}
