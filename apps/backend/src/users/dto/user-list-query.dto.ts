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
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // 默认值与上限取自 pagination.constants 的唯一定义处：硬编码会在改动契约时
  // 让 Swagger 文档、校验与各 service 的兜底值各自漂移
  @ApiPropertyOptional({ description: '每页条数', default: DEFAULT_PAGE_SIZE })
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
