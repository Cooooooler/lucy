import type { ValidationError } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception-factory.js';

function error(
  property: string,
  constraints: Record<string, string>,
  extra?: Partial<ValidationError>,
): ValidationError {
  return {
    property,
    constraints,
    contexts: undefined,
    children: undefined,
    target: undefined,
    value: undefined,
    ...extra,
  };
}

function messageOf(errors: ValidationError[]): string {
  const exception = validationExceptionFactory(errors);
  const body = exception.getResponse() as { message?: string };
  return body.message ?? '';
}

describe('validationExceptionFactory', () => {
  it('英文默认提示转中文（isString + 标签映射）', () => {
    expect(
      messageOf([error('title', { isString: 'title must be a string' })]),
    ).toBe('标题应为文本');
  });

  it('带约束数值：maxLength 生成含边界的文案', () => {
    expect(
      messageOf([
        error(
          'title',
          {
            maxLength: 'title must be shorter than or equal to 100 characters',
          },
          { contexts: { maxLength: { constraints: [100] } } },
        ),
      ]),
    ).toBe('标题长度不能超过 100 个字符');
  });

  it('length 取 min/max 区间', () => {
    expect(
      messageOf([
        error(
          'username',
          { length: 'username must be longer than or equal to 3 characters' },
          { contexts: { length: { constraints: [3, 50] } } },
        ),
      ]),
    ).toBe('用户名长度应在 3-50 个字符之间');
  });

  it('contexts 缺失时降级为不带数值的文案', () => {
    expect(
      messageOf([
        error('pageSize', { max: 'pageSize must not be greater than 100' }),
      ]),
    ).toBe('每页条数过大');
  });

  it('DTO 自定义中文 message 原样保留', () => {
    expect(messageOf([error('cursor', { matches: '无效的分页游标' })])).toBe(
      '无效的分页游标',
    );
    expect(
      messageOf([
        error('username', { matches: '用户名仅支持字母数字下划线连字符' }),
      ]),
    ).toBe('用户名仅支持字母数字下划线连字符');
  });

  it('whitelist 报错转「不支持的参数」', () => {
    expect(
      messageOf([
        error('hacker', {
          whitelistValidation: 'property hacker should not exist',
        }),
      ]),
    ).toBe('不支持的参数：hacker');
  });

  it('嵌套 children 递归取第一个，标签用叶子字段', () => {
    expect(
      messageOf([
        error(
          'query',
          {},
          {
            children: [
              error('page', { isInt: 'page must be an integer number' }),
            ],
          },
        ),
      ]),
    ).toBe('页码应为整数');
  });

  it('只取第一个错误，不把整棵树抛给前端', () => {
    expect(
      messageOf([
        error('title', { isString: 'title must be a string' }),
        error('name', { isString: 'name must be a string' }),
      ]),
    ).toBe('标题应为文本');
  });

  it('未知约束键回退「参数不合法」', () => {
    expect(
      messageOf([
        error('file', { isSomethingNew: 'file failed isSomethingNew' }),
      ]),
    ).toBe('「文件」参数不合法');
  });

  it('空数组回退通用文案', () => {
    expect(messageOf([])).toBe('请求参数有误');
  });

  it('未收录字段名回退属性名本身', () => {
    expect(
      messageOf([
        error('weirdField', { isString: 'weirdField must be a string' }),
      ]),
    ).toBe('weirdField应为文本');
  });
});
