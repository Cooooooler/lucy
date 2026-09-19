import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  // 登录是唯一没有长度边界的 auth 请求体：account 会直接进「按用户名或邮箱等值查询」，
  // 超长输入是廉价的扫描放大器。255 同时覆盖 username（50）与 email 形态
  @ApiProperty({
    description: '用户名或邮箱',
    example: 'lucy',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  // account 接受用户名或邮箱二选一，由 AuthService 依是否含 '@' 分流查询
  account: string;

  // 与注册侧的 bcrypt 上限（72）对齐：更长的密码在注册时就进不来，登录侧再挡一道
  @ApiProperty({
    description: '密码',
    example: 'Password1!',
    minLength: 1,
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
