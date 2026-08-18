import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '用户名或邮箱', example: 'lucy' })
  @IsString()
  @IsNotEmpty()
  // account 接受用户名或邮箱二选一，由 AuthService 依是否含 '@' 分流查询
  account: string;

  @ApiProperty({ description: '密码', example: 'Password1!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
