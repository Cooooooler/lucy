import { formatErrorForLog } from './error-format.js';

describe('formatErrorForLog', () => {
  it('Error 输出「[类名] message」并补自身栈', () => {
    const text = formatErrorForLog(new TypeError('boom'));
    expect(text).toContain('[TypeError] boom');
    expect(text).toContain('stack=');
  });

  it('非 Error 用 typeof 与字符串化，不会因缺 name 输出 undefined', () => {
    expect(formatErrorForLog('oops')).toBe('[string] oops');
    expect(formatErrorForLog(null)).toBe('[object] null');
  });

  it('包装错误优先补 cause 栈（根因只挂在 cause 上）', () => {
    const cause = new Error('decrypt root');
    const wrapped = new Error('API Key 解密失败', { cause });
    const text = formatErrorForLog(wrapped);
    expect(text).toContain('[Error] API Key 解密失败');
    expect(text).toContain('cause=');
    expect(text).toContain('decrypt root');
    expect(text).not.toContain('stack=');
  });

  it('cause 不是 Error 时回到自身栈，避免 [object Object]', () => {
    const wrapped = new Error('outer', { cause: { code: 'x' } });
    const text = formatErrorForLog(wrapped);
    expect(text).toContain('[Error] outer');
    expect(text).not.toContain('object Object');
  });
});
