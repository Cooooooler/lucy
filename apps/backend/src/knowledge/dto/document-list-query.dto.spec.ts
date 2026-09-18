import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentListQueryDto } from './document-list-query.dto.js';

describe('DocumentListQueryDto', () => {
  it('空 body 合法（cursor/limit/keyword 均可选）', async () => {
    expect(
      await validate(plainToInstance(DocumentListQueryDto, {})),
    ).toHaveLength(0);
  });

  it('合法 base64url 游标通过', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      cursor: 'eyJ0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiaSI6ImFiYyJ9',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('游标含 base64url 之外的字符校验失败', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      cursor: 'abc+def/ghi=',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('游标超长（>512）校验失败', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      cursor: 'a'.repeat(513),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("limit='5' 被转换为 number 5 并通过校验", async () => {
    const dto = plainToInstance(DocumentListQueryDto, { limit: '5' });
    expect(dto.limit).toBe(5);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('limit=0 / limit=101 校验失败（1..100）', async () => {
    expect(
      await validate(plainToInstance(DocumentListQueryDto, { limit: 0 })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(DocumentListQueryDto, { limit: 101 })),
    ).not.toHaveLength(0);
  });

  it('keyword 超过 100 字符校验失败（ILIKE 谓词走不了索引，超长输入是扫描放大器）', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      keyword: 'a'.repeat(101),
    });
    expect(await validate(dto)).not.toHaveLength(0);
    // 边界值本身合法
    expect(
      await validate(
        plainToInstance(DocumentListQueryDto, { keyword: 'a'.repeat(100) }),
      ),
    ).toHaveLength(0);
  });

  it('keyword 首尾空白被去掉', async () => {
    const dto = plainToInstance(DocumentListQueryDto, { keyword: '  正文  ' });
    expect(dto.keyword).toBe('正文');
    expect(await validate(dto)).toHaveLength(0);
  });
});
