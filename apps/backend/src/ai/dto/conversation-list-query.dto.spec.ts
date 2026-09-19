import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE_NUMBER } from '../../common/pagination/pagination.constants.js';
import { ConversationListQueryDto } from './conversation-list-query.dto.js';

describe('ConversationListQueryDto', () => {
  it('空 body 合法（page/pageSize 均可选）', async () => {
    expect(
      await validate(plainToInstance(ConversationListQueryDto, {})),
    ).toHaveLength(0);
  });

  it("'2' 被转换为 number 2 并通过校验", async () => {
    const dto = plainToInstance(ConversationListQueryDto, {
      page: '2',
      pageSize: '20',
    });
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(20);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('page=0 校验失败（最小为 1）', async () => {
    const dto = plainToInstance(ConversationListQueryDto, { page: 0 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("page='abc' 校验失败（非整数）", async () => {
    const dto = plainToInstance(ConversationListQueryDto, { page: 'abc' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('pageSize>100 校验失败（最大 100）', async () => {
    const dto = plainToInstance(ConversationListQueryDto, { pageSize: 101 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('page=1e300 校验失败（@IsInt 放行非安全整数，靠 @Max 拦住 500）', async () => {
    const dto = plainToInstance(ConversationListQueryDto, { page: 1e300 });
    expect(dto.page).toBe(1e300);
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('page 上界为 MAX_PAGE_NUMBER（含边界）', async () => {
    expect(
      await validate(
        plainToInstance(ConversationListQueryDto, {
          page: MAX_PAGE_NUMBER + 1,
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ConversationListQueryDto, { page: MAX_PAGE_NUMBER }),
      ),
    ).toHaveLength(0);
  });
});
