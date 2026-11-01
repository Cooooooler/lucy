import { PartialType } from '@nestjs/swagger';
import { CreateModelProviderDto } from './create-model-provider.dto.js';

/**
 * 更新模型供应商：所有字段可选。
 *
 * `apiKey` 省略（或前端留空后不发送）表示**保留原 Key**；传值则重新加密覆盖。
 * 注意 `@MinLength(1)` 仍随基类生效：留空必须表现为「不发送该字段」，而不是发送空串。
 *
 * 与知识库更新侧（Patch {"description": null} 会 500 的修复）同口径用
 * `PartialType(..., { skipNullProperties: false })`：默认调用给每个属性补 `@IsOptional()`，
 * 它把 `null` 与 `undefined` 一视同仁地跳过校验——显式 `null` 穿过全局管道进入服务层后
 * `name = null` 等会撞上列的 NOT NULL 约束（23502），或 `apiKey.trim()` 直接 TypeError，
 * 两者都被 `AllExceptionsFilter` 兜成 500。该选项改挂 `@ValidateIf(value !== undefined)`：
 * 省略仍不校验，显式 `null` 与空串都落到 400。
 */
export class UpdateModelProviderDto extends PartialType(
  CreateModelProviderDto,
  {
    skipNullProperties: false,
  },
) {}
