import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CURSOR_MAX_LENGTH,
  CURSOR_PATTERN,
} from '../../common/pagination/cursor.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination.constants.js';

export class DocumentListQueryDto {
  @ApiPropertyOptional({
    description: '分页游标（上一页返回的 nextCursor），省略表示第一页',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  // 字符集与长度上限取自 cursor.ts 的唯一定义处，避免与解码入口漂移
  @Matches(CURSOR_PATTERN, { message: '无效的分页游标' })
  cursor?: string;

  // 默认值与上限都取自 pagination.constants 的唯一定义处，与 `@Min`/`@Max` 校验、各 service
  // 的兜底同源；但 `minimum`/`maximum` 只进 OpenAPI 文档（/docs、docs-json）——这类数值约束
  // 在 `@lucy/shared` 的生成类型里不可表达（query 参数只是 `limit?: number`）
  @ApiPropertyOptional({
    description: '每页条数',
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  // 长度上限与 cursor 的边界策略保持一致：该关键字会拼成 `title ILIKE '%…%' OR content ILIKE '%…%'`，
  // 谓词无法走索引，超长输入是廉价的全表扫描放大器；顺带去掉首尾空白
  @ApiPropertyOptional({
    description: '匹配标题/内容的关键字（最多 100 字符）',
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
