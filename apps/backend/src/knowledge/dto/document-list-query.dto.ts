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

export class DocumentListQueryDto {
  @ApiPropertyOptional({
    description: '分页游标（上一页返回的 nextCursor），省略表示第一页',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  // base64url 字符集：不符者直接 400，避免把任意长/带特殊字符的输入带进解码与 SQL
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '无效的分页游标' })
  cursor?: string;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: '匹配标题/内容的关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
