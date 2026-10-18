import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentListQueryDto } from './document-list-query.dto.js';

describe('DocumentListQueryDto', () => {
  it('空 body 合法（page/pageSize/keyword 均可选）', async () => {
    expect(
      await validate(plainToInstance(DocumentListQueryDto, {})),
    ).toHaveLength(0);
  });

  // page/pageSize 的契约由基类 PageQueryDto 的 spec 钉住，这里只覆盖本 DTO 自己的字段

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

  it('page/pageSize 经 @Type(() => Number) 从查询串转成数字', async () => {
    const dto = plainToInstance(DocumentListQueryDto, {
      page: '3',
      pageSize: '50',
    });
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(50);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
