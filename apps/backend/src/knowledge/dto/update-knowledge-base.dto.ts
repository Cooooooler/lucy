import { PartialType } from '@nestjs/swagger';
import { KnowledgeBaseContentDto } from './knowledge-base-content.dto.js';

/**
 * 更新知识库：所有字段可选，省略即不修改。
 *
 * 用 `PartialType(..., { skipNullProperties: false })` 而非默认调用：默认会给每个属性补
 * `@IsOptional()`，而它把 `null` 与 `undefined` 一视同仁地跳过校验——于是 `PATCH
 * {"description": null}` 能穿过校验进入服务层，赋空后撞上列的 NOT NULL 约束（23502），
 * 被 `AllExceptionsFilter` 兜成 500（`name`/`visibility` 同理）。
 * 该选项改挂 `@ValidateIf(value !== undefined)`：省略仍不校验，显式 `null` 与空串都落到 400。
 *
 * **只映射内容字段**：检索设置只在创建时确定，之后只读。全局 ValidationPipe 的
 * `forbidNonWhitelisted` 会把 PATCH 里的检索字段直接拦成 400（「不支持的参数」）。
 */
export class UpdateKnowledgeBaseDto extends PartialType(
  KnowledgeBaseContentDto,
  {
    skipNullProperties: false,
  },
) {}
