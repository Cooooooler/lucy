import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RenameConversationDto } from './rename-conversation.dto.js';

describe('RenameConversationDto', () => {
  it('title 为空校验失败', async () => {
    expect(
      await validate(plainToInstance(RenameConversationDto, { title: '' })),
    ).not.toHaveLength(0);
  });

  it('title 合法通过', async () => {
    expect(
      await validate(
        plainToInstance(RenameConversationDto, { title: '新标题' }),
      ),
    ).toHaveLength(0);
  });

  it('title 超 50 字符校验失败', async () => {
    expect(
      await validate(
        plainToInstance(RenameConversationDto, { title: 'x'.repeat(51) }),
      ),
    ).not.toHaveLength(0);
  });
});
