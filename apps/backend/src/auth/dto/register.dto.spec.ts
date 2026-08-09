import { validate } from 'class-validator';
import 'reflect-metadata';
import { RegisterDto } from './register.dto.js';

const validBase = {
  username: 'alice',
  email: 'alice@example.com',
  nickname: 'Alice',
};

const buildDto = (overrides: Partial<RegisterDto> = {}) => {
  const dto = new RegisterDto();
  Object.assign(dto, validBase, { password: 'ValidPass1!' }, overrides);
  return dto;
};

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
});
