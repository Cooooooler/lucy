import { errorLogFields } from './error-format.js';

describe('errorLogFields', () => {
  it('Error 抽成 type/message/stack 字段（可按 err.type 聚合）', () => {
    const fields = errorLogFields(new TypeError('boom'));
    expect(fields.type).toBe('TypeError');
    expect(fields.message).toBe('boom');
    expect(fields.stack).toContain('TypeError: boom');
  });

  it('非 Error 用 typeof 与字符串化，不会因缺 name 输出 undefined', () => {
    expect(errorLogFields('oops')).toEqual({ type: 'string', message: 'oops' });
    expect(errorLogFields(null)).toEqual({ type: 'object', message: 'null' });
  });

  it('包装错误把根因抽成 cause 字段（与顶层字段同形）', () => {
    const cause = new Error('decrypt root');
    const fields = errorLogFields(new Error('API Key 解密失败', { cause }));
    expect(fields).toMatchObject({
      type: 'Error',
      message: 'API Key 解密失败',
      cause: { type: 'Error', message: 'decrypt root' },
    });
    expect(fields.cause?.stack).toContain('decrypt root');
  });

  it('cause 不是 Error 时不生成 cause 字段（避免 [object Object]）', () => {
    const fields = errorLogFields(
      new Error('outer', { cause: { code: 'x' } as unknown as Error }),
    );
    expect(fields).not.toHaveProperty('cause');
    expect(JSON.stringify(fields)).not.toContain('[object Object]');
  });
});
