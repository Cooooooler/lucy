import { createValidationPipe } from '../../common/validation-pipe.js';
import { CreateConversationDto } from './create-conversation.dto.js';

/**
 * 经真实全局管道（`createValidationPipe` 与 `CommonModule` 的 APP_PIPE 同一份配置）验证：
 * 空 body 放行、未知字段被 400。
 *
 * 不走 class-validator 默认选项直调 `validate`：其 `forbidUnknownValues` 默认值与 Nest
 * 的 ValidationPipe（显式置 false）不同，空 DTO 会被误判为「unknown value」。
 */
describe('CreateConversationDto 经全局 ValidationPipe', () => {
  const pipe = createValidationPipe();

  // transform 的返回类型是 any，显式收成 unknown 以免 any 逃逸
  const throughPipe = (value: unknown): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: CreateConversationDto });

  it('空 body 放行并转成 DTO 实例', async () => {
    const result = await throughPipe({});
    expect(result).toBeInstanceOf(CreateConversationDto);
  });

  it('未知字段被 400（依赖线上的 forbidNonWhitelisted）', async () => {
    await expect(throughPipe({ model: 'qwen' })).rejects.toThrow();
  });
});
