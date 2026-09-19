import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination.constants.js';

export class ConversationListQueryDto {
  // 页码不设产品上界（深翻页由 OFFSET 语义决定），但必须挡住非安全整数：`@IsInt` 基于
  // `Number.isInteger`，会放行 1e300，服务层只能静默降级为第 1 页 —— 200 返回的却不是
  // 请求的那一页，唯一线索是响应里的 page。`Number.MAX_SAFE_INTEGER` 是 JS 可表示整数的
  // 天花板、不是产品上限，越界请求在 DTO 层直接 400
  @ApiPropertyOptional({
    description: '页码',
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;

  // 默认值与上限取自 pagination.constants 的唯一定义处，且用 `default:`（不是 `example:`）
  // 与另三个列表 DTO 一致：这两项是实际生效的默认值/边界，会进 OpenAPI 文档
  // （`minimum`/`maximum` 不进 `@lucy/shared` 的类型——数值约束在类型里不可表达）
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
  pageSize?: number;
}
