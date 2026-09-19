import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { RegisterDto } from './register.dto.js';

const validBase = {
  username: 'alice',
  email: 'alice@example.com',
  nickname: 'Alice',
};

// 走 plainToInstance 而不是 new + Object.assign：@Transform（密码 trim）只在
// class-transformer 的转换阶段执行，直接赋值会绕过它，测不到真实管线
const buildDto = (overrides: Partial<RegisterDto> = {}) =>
  plainToInstance(RegisterDto, {
    ...validBase,
    password: 'ValidPass1!',
    ...overrides,
  });

describe('RegisterDto 密码强度校验', () => {
  it('符合全部强度要求的密码通过校验', async () => {
    const errors = await validate(buildDto());
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['缺少小写字母', 'VALIDPASS1!'],
    ['缺少大写字母', 'validpass1!'],
    ['缺少数字', 'Validpass!'],
    ['缺少特殊字符', 'Validpass1'],
    ['长度不足 8 位', 'Valid1!'],
    ['长度超过 72 位', 'Aa1!'.repeat(19)],
  ])('%s 的密码被拒绝', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    const passwordErrors = errors.filter((e) => e.property === 'password');
    expect(passwordErrors.length).toBeGreaterThan(0);
  });

  // 「特殊字符」按非字母数字**且非空白**判定（[^a-zA-Z0-9\s]），不是符号白名单：
  // 白名单此前漏了 _/-/~ 等常用符号，Str0ng-Pass 会被 400 且报错误导用户
  it.each([
    ['连字符', 'Str0ng-Pass'],
    ['下划线', 'Str0ng_Pass'],
    ['波浪号', 'Str0ng~Pass'],
  ])('含 %s 的密码视为包含特殊字符，通过校验', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    expect(errors).toHaveLength(0);
  });

  // 空白不能充当「特殊字符」：这类密码在界面上不可见、客户端又常自行 trim，
  // 会造出「密码明明对却登不进去」且无法复现的账号
  it.each([
    ['空格', 'Str0ng Pass'],
    ['制表符', 'Str0ng\tPass'],
    ['换行', 'Str0ng\nPass'],
  ])('仅靠 %s 充当特殊字符的密码被拒绝', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    const passwordErrors = errors.filter((e) => e.property === 'password');
    expect(passwordErrors.length).toBeGreaterThan(0);
  });

  it('密码首尾空白被 trim 后再校验（粘贴带入的不可见空白不落库）', async () => {
    const dto = buildDto({ password: '  ValidPass1!  ' });
    await validate(dto);
    expect(dto.password).toBe('ValidPass1!');
  });
});
