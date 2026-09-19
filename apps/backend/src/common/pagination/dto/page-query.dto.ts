import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination.constants.js';

/**
 * 页码分页的请求参数基类——页码与每页条数的**唯一定义处**。
 *
 * 为什么收成基类：这组参数（含上下限与 Swagger 边界）此前在 `user-list-query.dto.ts` 与
 * `conversation-list-query.dto.ts` 里各写一份逐字相同的实现，改一处就会漂移；两份 6 行
 * 的 `@ApiPropertyOptional` 对象字面量还会被判为新代码重复（Sonar CPD），把质量门禁顶红。
 * 各模块需要页码分页时继承它（或直接用它），不再各自声明。
 */
export class PageQueryDto {
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

  // 默认值与上限取自 pagination.constants 的唯一定义处；`minimum`/`maximum` 只进 OpenAPI
  // 文档（/docs、docs-json）——`@Max` 之类的装饰器不会自动进 schema（未启用 swagger CLI
  // 插件），所以必须在这里显式声明
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
