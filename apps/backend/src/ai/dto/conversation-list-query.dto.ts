import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination.constants.js';

export class ConversationListQueryDto {
  @ApiPropertyOptional({ description: '页码', example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // 默认值与上限取自 pagination.constants 的唯一定义处：硬编码会在改动契约时
  // 让 Swagger 文档、校验与 controller 的兜底值各自漂移
  @ApiPropertyOptional({
    description: '每页条数',
    example: DEFAULT_PAGE_SIZE,
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
