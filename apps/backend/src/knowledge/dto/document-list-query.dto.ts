import { KNOWLEDGE_KEYWORD_MAX_LENGTH } from '@lucy/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination/dto/page-query.dto.js';

/**
 * 文档列表的请求参数：**页码分页**（与用户管理列表共用 `PageQueryDto` 的边界策略），
 * 这里只声明本列表自己的过滤字段。
 *
 * 为什么不是游标分页：本列表的消费方是知识库详情页的文件表格，要页码、总条数与跳页，
 * 游标（nextCursor）表达不了这些；知识库**列表**仍是游标分页（卡片 + 虚拟网格无限滚动）。
 */
export class DocumentListQueryDto extends PageQueryDto {
  // 长度上限与分页参数的边界策略保持一致：该关键字会拼成 `title ILIKE '%…%' OR content ILIKE '%…%'`，
  // 谓词无法走索引，超长输入是廉价的全表扫描放大器；顺带去掉首尾空白
  @ApiPropertyOptional({
    description: `匹配标题/内容的关键字（最多 ${KNOWLEDGE_KEYWORD_MAX_LENGTH} 字符）`,
    maxLength: KNOWLEDGE_KEYWORD_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(KNOWLEDGE_KEYWORD_MAX_LENGTH)
  keyword?: string;
}
