import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CursorQueryDto } from './cursor-query.dto.js';

describe('CursorQueryDto', () => {
  it('空 body 合法（cursor/limit 均可选）', async () => {
    expect(await validate(plainToInstance(CursorQueryDto, {}))).toHaveLength(0);
  });

  it('合法 base64url 游标通过', async () => {
    const dto = plainToInstance(CursorQueryDto, {
      cursor: 'eyJ0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiaSI6ImFiYyJ9',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('游标含 base64url 之外的字符校验失败', async () => {
    const dto = plainToInstance(CursorQueryDto, { cursor: 'abc+def/ghi=' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('游标超长（>512）校验失败', async () => {
    const dto = plainToInstance(CursorQueryDto, { cursor: 'a'.repeat(513) });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('游标非字符串校验失败', async () => {
    const dto = plainToInstance(CursorQueryDto, { cursor: 123 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("limit='10' 被转换为 number 10 并通过校验", async () => {
    const dto = plainToInstance(CursorQueryDto, { limit: '10' });
    expect(dto.limit).toBe(10);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('limit=0 / limit=101 校验失败（1..100）', async () => {
    expect(
      await validate(plainToInstance(CursorQueryDto, { limit: 0 })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(CursorQueryDto, { limit: 101 })),
    ).not.toHaveLength(0);
  });
});
