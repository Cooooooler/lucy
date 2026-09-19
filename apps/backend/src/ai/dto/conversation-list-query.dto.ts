import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination.constants.js';

export class ConversationListQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // 默认值与上限取自 pagination.constants 的唯一定义处，且用 `default:`（不是 `example:`）
  // 与另三个列表 DTO 一致：这两项是实际生效的默认值/边界，会经 typegen 进共享契约与前端文档
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
