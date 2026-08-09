import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateConversationDto } from './create-conversation.dto.js';

describe('CreateConversationDto', () => {
  it('空 body 合法（model 可选）', async () => {
    expect(
      await validate(plainToInstance(CreateConversationDto, {})),
    ).toHaveLength(0);
  });

  it('model 超长校验失败', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      model: 'x'.repeat(200),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
