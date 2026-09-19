import {
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '@lucy/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterDto {
  // 边界值与正则都取自 @lucy/shared 的唯一定义处：前端 zod 与强度指示用同一份，
  // 两边各写一份时已经出现过「后端放宽、前端仍拦」的实际漂移
  // （pattern/minLength 仍要与下方装饰器同步写进文档选项：Swagger 不解析装饰器）
  @ApiProperty({
    description: '用户名，仅支持字母数字下划线连字符',
    example: 'lucy',
    minLength: USERNAME_MIN_LENGTH,
    maxLength: USERNAME_MAX_LENGTH,
    pattern: USERNAME_PATTERN.source,
  })
  @IsString()
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(USERNAME_PATTERN, { message: '用户名仅支持字母数字下划线连字符' })
  username: string;

  // 上界与 users.email 列（varchar(255)）对齐：isEmail 只约束局部 ≤64/域名 ≤253 字节，
  // 整串可达 ~318，不挡的话 256–318 会过 DTO、却在插入时报 22001（500 而不是 400）
  @ApiProperty({
    description: '邮箱',
    example: 'lucy@example.com',
    format: 'email',
    maxLength: EMAIL_MAX_LENGTH,
  })
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  // 复杂度正则带前瞻、且需要 u 标志，而 JSON Schema 的 pattern 没有 flags 位、
  // 多个引擎（Go RE2、Rust regex）编译前瞻直接失败——写进契约会让非 JS 消费方生成不出代码。
  // 长度边界照常下发，复杂度规则放 description 说明。
  @ApiProperty({
    description: `密码（${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位，需含大写字母、小写字母、数字与至少一个符号/标点；首尾不能是空白）`,
    example: 'Password1!',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message:
      '密码需包含大写字母、小写字母、数字与至少一个符号（首尾不能是空白）',
  })
  password: string;

  @ApiPropertyOptional({
    description: '昵称',
    example: 'Lucy',
    minLength: NICKNAME_MIN_LENGTH,
    maxLength: NICKNAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @Length(NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH)
  nickname?: string;
}
