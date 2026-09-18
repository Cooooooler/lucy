import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeListQueryDto } from './knowledge-list-query.dto.js';

describe('KnowledgeListQueryDto', () => {
  it('空 body 合法（cursor/limit/visibility/name 均可选）', async () => {
    expect(
      await validate(plainToInstance(KnowledgeListQueryDto, {})),
    ).toHaveLength(0);
  });

  it('合法 base64url 游标通过', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, {
      cursor: 'eyJ0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiaSI6ImFiYyJ9',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('游标含 base64url 之外的字符校验失败', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, {
      cursor: 'abc+def/ghi=',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('游标超长（>512）校验失败', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, {
      cursor: 'a'.repeat(513),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('游标非字符串校验失败', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, { cursor: 123 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("limit='10' 被转换为 number 10 并通过校验", async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, { limit: '10' });
    expect(dto.limit).toBe(10);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('limit=0 / limit=101 校验失败（1..100）', async () => {
    expect(
      await validate(plainToInstance(KnowledgeListQueryDto, { limit: 0 })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(KnowledgeListQueryDto, { limit: 101 })),
    ).not.toHaveLength(0);
  });

  it('name 超过 100 字符校验失败（ILIKE 谓词走不了索引，超长输入是扫描放大器）', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, {
      name: 'a'.repeat(101),
    });
    expect(await validate(dto)).not.toHaveLength(0);
    // 边界值本身合法
    expect(
      await validate(
        plainToInstance(KnowledgeListQueryDto, { name: 'a'.repeat(100) }),
      ),
    ).toHaveLength(0);
  });

  it('name 首尾空白被去掉', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, { name: '  产品  ' });
    expect(dto.name).toBe('产品');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('visibility 非法值校验失败', async () => {
    const dto = plainToInstance(KnowledgeListQueryDto, { visibility: 'team' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
