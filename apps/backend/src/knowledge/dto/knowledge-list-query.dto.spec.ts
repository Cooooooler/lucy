import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeListQueryDto } from './knowledge-list-query.dto.js';

describe('KnowledgeListQueryDto', () => {
  it('空 body 合法（cursor/limit/visibility/name 均可选）', async () => {
    expect(
      await validate(plainToInstance(KnowledgeListQueryDto, {})),
    ).toHaveLength(0);
  });

  // cursor / limit 的契约（含游标字符集与条数上下限）由基类 CursorQueryDto 的 spec 钉住，
  // 这里只覆盖本 DTO 自己的字段，避免同一份断言在四处重复维护

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
