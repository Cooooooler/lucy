import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentListQueryDto } from './document-list-query.dto.js';

describe('DocumentListQueryDto', () => {
  it('空 body 合法（cursor/limit/keyword 均可选）', async () => {
    expect(
      await validate(plainToInstance(DocumentListQueryDto, {})),
    ).toHaveLength(0);
  });

  // cursor / limit 的契约由基类 CursorQueryDto 的 spec 钉住，这里只覆盖本 DTO 自己的字段

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
