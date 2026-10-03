import { PartialType } from '@nestjs/swagger';
import { CreateModelProviderDto } from './create-model-provider.dto.js';

/**
 * 更新模型供应商：所有字段可选。
 *
 * `apiKey` 省略（或前端留空后不发送）表示**保留原 Key**；传值则重新加密覆盖。
 * 注意 `@MinLength(1)` 仍随基类生效：留空必须表现为「不发送该字段」，而不是发送空串。
 */
export class UpdateModelProviderDto extends PartialType(
  CreateModelProviderDto,
) {}
