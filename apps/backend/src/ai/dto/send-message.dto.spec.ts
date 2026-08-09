import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageDto } from './send-message.dto.js';

describe('SendMessageDto', () => {
  it('content 必填，为空校验失败', async () => {
    const dto = plainToInstance(SendMessageDto, { content: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('content 合法，model 可选', async () => {
    expect(
      await validate(plainToInstance(SendMessageDto, { content: 'hi' })),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(SendMessageDto, { content: 'hi', model: 'qwen' }),
      ),
    ).toHaveLength(0);
  });

  it('model 超长校验失败', async () => {
    const dto = plainToInstance(SendMessageDto, {
      content: 'hi',
      model: 'x'.repeat(200),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
