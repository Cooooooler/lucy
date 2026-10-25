import type { ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { TYPE_CONSTRAINT_KEYS, VALIDATION_MESSAGES } from './messages.js';
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

  it('带约束数值的模板不可达：数值文案为常量（本仓 DTO 未声明 validationOptions.context）', () => {
    // 手工构造 contexts 也不会有人消费：模板不再取约束数值，保持「过大/过长」常量文案
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
    ).toBe('标题过长');
  });

  it('类型类约束优先：null 命中 isString 而非注册在前的 min/max/length', () => {
    // 模拟 `{"name": null}` 的真实约束序（装饰器自下而上注册，maxLength 在前）：
    // 旧行为取第一个键报「名称过长」，对 null 是误导文案
    const maxWidthLengthName = error('name', {
      maxLength: 'name must be shorter than or equal to 100 characters',
      minLength: 'name must be longer than or equal to 1 characters',
      isString: 'name must be a string',
    });
    expect(messageOf([maxWidthLengthName])).toBe('名称应为文本');
    // 模拟注册序 min/max 在前、无任何类型类约束命中（matches 不属于类型类）：
    // 仍取第一个键，行为不变
    expect(
      messageOf([
        error('title', {
          maxLength: 'title must be shorter than or equal to 10 characters',
          matches: 'title must match a pattern',
        }),
      ]),
    ).toBe('标题过长');
  });

  it('类型类约束优先清单与模板一一对应（遗漏会静默复发误导文案）', () => {
    expect(
      TYPE_CONSTRAINT_KEYS.every(
        (key) => typeof VALIDATION_MESSAGES[key] === 'function',
      ),
    ).toBe(true);
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

  it('原型链字段名不泄漏函数源码（如 constructor）', () => {
    expect(
      messageOf([
        error('constructor', {
          whitelistValidation: 'property constructor should not exist',
        }),
      ]),
    ).toBe('不支持的参数：constructor');
  });
});
