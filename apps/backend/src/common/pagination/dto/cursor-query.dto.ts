import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CURSOR_MAX_LENGTH, CURSOR_PATTERN } from '../cursor.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination.constants.js';

/**
 * 游标（keyset）分页的请求参数基类——游标与每页条数的**唯一定义处**。
 *
 * 与 {@link PageQueryDto} 同理：这组参数此前在 `knowledge-list-query.dto.ts` 与
 * `document-list-query.dto.ts` 里各写一份逐字相同的实现，既有漂移风险，也会被判为新代码
 * 重复。各模块需要游标分页时继承它，只声明自己的过滤字段。
 */
export class CursorQueryDto {
  // 游标的长度上限与 base64url 字符集同样要写进文档选项：Swagger 不解析装饰器，
  // 漏写时 /docs 里 cursor 就是一个无边界字符串；两值取自 cursor.ts 的唯一定义处
  @ApiPropertyOptional({
    description: '分页游标（上一页返回的 nextCursor），省略表示第一页',
    maxLength: CURSOR_MAX_LENGTH,
    pattern: CURSOR_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  // 字符集与长度上限取自 cursor.ts 的唯一定义处，避免与解码入口漂移
  @Matches(CURSOR_PATTERN, { message: '无效的分页游标' })
  cursor?: string;

  // 每页条数的默认值与上限同样取自 pagination.constants 的唯一定义处；`minimum`/`maximum`
  // 只进 OpenAPI 文档（/docs、docs-json）——`@Max` 之类的装饰器不会自动进 schema
  // （未启用 swagger CLI 插件），所以必须在这里显式声明
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
}
