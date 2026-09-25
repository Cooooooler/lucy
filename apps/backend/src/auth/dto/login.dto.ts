import { LOGIN_ACCOUNT_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  // 登录是唯一没有长度边界的 auth 请求体：account 会直接进「按用户名或邮箱等值查询」，
  // 超长输入是廉价的扫描放大器。上界覆盖 username（50）与 email（255）两种形态
  @ApiProperty({
    description: '用户名或邮箱',
    example: 'lucy',
    minLength: 1,
    maxLength: LOGIN_ACCOUNT_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOGIN_ACCOUNT_MAX_LENGTH)
  // account 接受用户名或邮箱二选一，由 AuthService 依是否含 '@' 分流查询
  account: string;

  // 刻意**不 trim**：trim 等于把待验证凭据换成另一个字符串，而旧版注册正则没有 `$` 锚定、
  // 曾放行过含首尾空白的密码（` Pass1! ` 会被原样哈希），那些存量账号一旦在登录侧被 trim
  // 就永远 401，且本仓库没有改密/重置入口。上界与注册侧 @Length(8, 72) 同范围，
  // 只挡明显越界输入（真正的强度判定在注册侧；哈希是 node:crypto scrypt，无 bcrypt 的截断一说）
  @ApiProperty({
    description: '密码',
    example: 'Password1!',
    minLength: 1,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
