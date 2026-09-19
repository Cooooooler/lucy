import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PASSWORD_PATTERN, USERNAME_PATTERN } from './register.constraints.js';

export class RegisterDto {
  // pattern/minLength 等约束要与下方 class-validator 装饰器同步写两处：
  // Swagger 不解析装饰器，漏写文档就不体现边界（正则用 .source 引用同一份，防拷贝漂移）
  @ApiProperty({
    description: '用户名，仅支持字母数字下划线连字符',
    example: 'lucy',
    minLength: 3,
    maxLength: 50,
    pattern: USERNAME_PATTERN.source,
  })
  @IsString()
  @Length(3, 50)
  @Matches(USERNAME_PATTERN, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  @ApiProperty({
    description: '邮箱',
    example: 'lucy@example.com',
    format: 'email',
  })
  @IsEmail()
  email: string;

  // 复杂度正则带前瞻、且需要 u 标志，而 JSON Schema 的 pattern 没有 flags 位、
  // 多个引擎（Go RE2、Rust regex）编译前瞻直接失败——写进契约会让非 JS 消费方生成不出代码。
  // 边界（长度）照常下发，复杂度规则放 description 说明。
  @ApiProperty({
    description:
      '密码（8-72 位，需含大写字母、小写字母、数字与至少一个符号/标点；首尾不能是空白）',
    example: 'Password1!',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_PATTERN, {
    message:
      '密码需包含大写字母、小写字母、数字与至少一个符号（首尾不能是空白）',
  })
  password: string;

  @ApiPropertyOptional({
    description: '昵称',
    example: 'Lucy',
    minLength: 1,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;
}
