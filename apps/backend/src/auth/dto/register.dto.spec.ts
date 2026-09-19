import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { RegisterDto } from './register.dto.js';

const validBase = {
  username: 'alice',
  email: 'alice@example.com',
  nickname: 'Alice',
};

// 走 plainToInstance 而不是 new + Object.assign：与线上路径一致（ValidationPipe 先
// class-transformer 转换、再 class-validator 校验），构造器直构会跳过转换阶段
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

  // 「特殊字符」判据是 [^\p{L}\p{N}\p{C}\p{Z}]（只放行符号/标点），不是符号白名单：
  // 白名单此前漏了 _/-/~ 等常用符号，Str0ng-Pass 会被 400 且报错误导用户
  it.each([
    ['连字符', 'Str0ng-Pass'],
    ['下划线', 'Str0ng_Pass'],
    ['波浪号', 'Str0ng~Pass'],
  ])('含 %s 的密码视为包含特殊字符，通过校验', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    expect(errors).toHaveLength(0);
  });

  // 不可见/非符号字符不能充当「特殊字符」——它们要么看不见（空白、零宽），
  // 要么根本不是用户心中的「符号」（汉字是 \p{L}）
  it.each([
    ['空格', 'Str0ng Pass'],
    ['制表符', 'Str0ng\tPass'],
    ['换行', 'Str0ng\nPass'],
    ['零宽空格 U+200B', 'Str0ng\u200bPass'],
    ['汉字', 'Aa1中文字符串'],
  ])('仅靠 %s 充当特殊字符的密码被拒绝', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    const passwordErrors = errors.filter((e) => e.property === 'password');
    expect(passwordErrors.length).toBeGreaterThan(0);
  });

  // 首尾空白直接拒绝而不是 trim：trim 会把待验证凭据悄悄换成另一个字符串，
  // 而旧版正则（无 $ 锚定）放行过含首尾空白的密码并原样哈希，登录侧一旦也 trim，
  // 那些存量账号就永远 401（本仓库没有改密入口）
  it.each([
    ['前导', ' ValidPass1!'],
    ['尾随', 'ValidPass1! '],
  ])('%s 空白的密码被拒绝（不静默 trim）', async (_label, password) => {
    const errors = await validate(buildDto({ password }));
    const passwordErrors = errors.filter((e) => e.property === 'password');
    expect(passwordErrors.length).toBeGreaterThan(0);
  });
});

// 属性级校验之外，再钉住真正生效的入口：全局 APP_PIPE 的配置
// （common.module.ts 的 whitelist/forbidNonWhitelisted/transform）被误改时这里要红
describe('RegisterDto 经全局 ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  // ValidationPipe.transform 的返回类型是 any，显式收成 unknown 以免 any 逃逸
  const throughPipe = (value: unknown): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: RegisterDto });

  it('合法请求体被放行并转成 DTO 实例', async () => {
    const result = await throughPipe({
      ...validBase,
      password: 'ValidPass1!',
    });
    expect(result).toBeInstanceOf(RegisterDto);
  });

  it('非白名单字段被 400（与线上 forbidNonWhitelisted 一致）', async () => {
    await expect(
      throughPipe({
        ...validBase,
        password: 'ValidPass1!',
        isAdmin: true,
      }),
    ).rejects.toThrow();
  });

  it('越界密码被 400', async () => {
    await expect(
      throughPipe({ ...validBase, password: ' Pass1! ' }),
    ).rejects.toThrow();
  });
});
