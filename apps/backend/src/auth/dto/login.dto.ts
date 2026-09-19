import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

  // 上界与注册侧 RegisterDto 的 @Length(8, 72) 同范围：登录只挡明显越界输入，
  // 真正的强度判定在注册侧（哈希是 node:crypto scrypt，没有 bcrypt 的 72 字节截断一说）
  @ApiProperty({
    description: '密码',
    example: 'Password1!',
    minLength: 1,
    maxLength: 72,
  })
  // 与注册侧一致地 trim：注册时入库的是 trim 后的值，登录不 trim 会让
  // 「粘贴密码时带了个尾随空格」直接 401
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
