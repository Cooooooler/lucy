import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination.constants.js';

export class UserListQueryDto {
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

  // 默认值与上限取自 pagination.constants 的唯一定义处：硬编码会在改动契约时
  // 让 Swagger 文档、校验与各 service 的兜底值各自漂移。
  // `minimum`/`maximum` 只进 OpenAPI 文档（/docs、docs-json）：`@Max` 之类的装饰器不会自动
  // 进 schema（未启用 swagger CLI 插件），所以必须在这里显式声明
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

  @ApiPropertyOptional({
    description: '按状态过滤：1 正常，0 禁用',
    enum: [1, 0],
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  status?: number;

  @ApiPropertyOptional({
    description: '匹配用户名/邮箱/昵称的关键字',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;
}
