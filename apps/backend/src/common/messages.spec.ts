import {
  FIELD_LABELS,
  HTTP_STATUS_MESSAGES,
  RATE_LIMIT_MESSAGE,
  fieldLabel,
  isFrameworkDefaultMessage,
} from './messages.js';

describe('messages', () => {
  it('RATE_LIMIT_MESSAGE 与 429 兜底同源', () => {
    expect(HTTP_STATUS_MESSAGES[429]).toBe(RATE_LIMIT_MESSAGE);
  });

  it('fieldLabel：已知字段翻中文，未知回退属性名', () => {
    expect(fieldLabel('username')).toBe('用户名');
    expect(fieldLabel('weirdField')).toBe('weirdField');
  });

  it('fieldLabel：不命中原型链（constructor/toString/__proto__）', () => {
    for (const prop of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(fieldLabel(prop)).toBe(prop);
    }
    // 映射表本身不含原型链上的键
    expect(Object.hasOwn(FIELD_LABELS, 'constructor')).toBe(false);
    expect(Object.hasOwn(FIELD_LABELS, 'toString')).toBe(false);
  });

  it('isFrameworkDefaultMessage：字符串 / 数组 / 对象 message', () => {
    expect(isFrameworkDefaultMessage('Unauthorized')).toBe(true);
    expect(isFrameworkDefaultMessage('File too large')).toBe(true);
    expect(
      isFrameworkDefaultMessage('Validation failed (uuid is expected)'),
    ).toBe(true);
    expect(isFrameworkDefaultMessage('用户名或密码错误')).toBe(false);
    expect(isFrameworkDefaultMessage(['ok', 'Too Many Requests'])).toBe(true);
    expect(isFrameworkDefaultMessage(['ok', 'fine'])).toBe(false);
    expect(isFrameworkDefaultMessage({ message: 'Forbidden' })).toBe(true);
    expect(isFrameworkDefaultMessage({ message: '业务中文' })).toBe(false);
    expect(isFrameworkDefaultMessage(undefined)).toBe(false);
    expect(isFrameworkDefaultMessage(null)).toBe(false);
    expect(isFrameworkDefaultMessage(42)).toBe(false);
  });
});
