import { ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { CommonModule } from '../../common/common.module.js';
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

// 两个 helper 收口「取 password 字段的错误并断言」，免得同一段断言在六个 it.each 里各抄一份
const passwordErrorsOf = async (password: string) => {
  const errors = await validate(buildDto({ password }));
  return errors.filter((e) => e.property === 'password');
};
const expectPasswordRejected = async (password: string): Promise<void> => {
  expect(await passwordErrorsOf(password)).not.toHaveLength(0);
};
const expectPasswordAccepted = async (password: string): Promise<void> => {
  expect(await passwordErrorsOf(password)).toHaveLength(0);
};

describe('RegisterDto 密码强度校验', () => {
  it('符合全部强度要求的密码通过校验', async () => {
    await expectPasswordAccepted('ValidPass1!');
  });

  it.each([
    ['缺少小写字母', 'VALIDPASS1!'],
    ['缺少大写字母', 'validpass1!'],
    ['缺少数字', 'Validpass!'],
    ['缺少特殊字符', 'Validpass1'],
    ['长度不足 8 位', 'Valid1!'],
    ['长度超过 72 位', 'Aa1!'.repeat(19)],
  ])('%s 的密码被拒绝', async (_label, password) => {
    await expectPasswordRejected(password);
  });

  // 「特殊字符」判据是 [^\p{L}\p{N}\p{C}\p{Z}]（只放行符号/标点），不是符号白名单：
  // 白名单此前漏了 _/-/~ 等常用符号，Str0ng-Pass 会被 400 且报错误导用户
  it.each([
    ['连字符', 'Str0ng-Pass'],
    ['下划线', 'Str0ng_Pass'],
    ['波浪号', 'Str0ng~Pass'],
  ])('含 %s 的密码视为包含特殊字符，通过校验', async (_label, password) => {
    await expectPasswordAccepted(password);
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
    await expectPasswordRejected(password);
  });

  // 首尾空白直接拒绝而不是 trim：trim 会把待验证凭据悄悄换成另一个字符串，
  // 而旧版正则（无 $ 锚定）放行过含首尾空白的密码并原样哈希，登录侧一旦也 trim，
  // 那些存量账号就永远 401（本仓库没有改密入口）
  it.each([
    ['前导', ' ValidPass1!'],
    ['尾随', 'ValidPass1! '],
  ])('%s 空白的密码被拒绝（不静默 trim）', async (_label, password) => {
    await expectPasswordRejected(password);
  });

  // 前瞻用 [\s\S]* 而非 .*：内部换行会把串切成两段，符号只出现在换行之后时
  // `.*` 看不见它，用户明明带了符号却被提示「需包含符号」
  it.each([
    ['符号', 'Aa1\nPass!'],
    ['大写字母', 'aa1!\nPass'],
  ])(
    '位于换行之后的 %s 仍被前瞻看见，密码通过校验',
    async (_label, password) => {
      await expectPasswordAccepted(password);
    },
  );
});

// 属性级校验之外，再钉住真正生效的入口。实例取自 CommonModule 的声明本身，
// 不是手抄一份选项——线上 APP_PIPE 配置改了（例如去掉 forbidNonWhitelisted），
// 下面的行为断言就会红。
// 不用 Test.createTestingModule 编译 CommonModule：它的 AppLogger 依赖 ClsService
// 与 nestjs-pino 的 Logger，脱离 AppModule 起不来。
const globalValidationPipe = (
  Reflect.getMetadata('providers', CommonModule) as
    { provide?: unknown; useValue?: unknown }[] | undefined
)?.find((provider) => provider.provide === APP_PIPE)?.useValue;

describe('RegisterDto 经 CommonModule 注册的全局 ValidationPipe', () => {
  const pipe = globalValidationPipe as ValidationPipe;
  // transform 的返回类型是 any，显式收成 unknown 以免 any 逃逸
  const throughPipe = (value: unknown): Promise<unknown> =>
    pipe.transform(value, { type: 'body', metatype: RegisterDto });

  it('CommonModule 注册了全局 ValidationPipe', () => {
    expect(globalValidationPipe).toBeInstanceOf(ValidationPipe);
  });

  it('合法请求体被放行并转成 DTO 实例', async () => {
    const result = await throughPipe({ ...validBase, password: 'ValidPass1!' });
    expect(result).toBeInstanceOf(RegisterDto);
  });

  it('非白名单字段被 400（依赖线上的 forbidNonWhitelisted）', async () => {
    await expect(
      throughPipe({ ...validBase, password: 'ValidPass1!', isAdmin: true }),
    ).rejects.toThrow();
  });

  it('越界密码被 400', async () => {
    await expect(
      throughPipe({ ...validBase, password: ' Pass1! ' }),
    ).rejects.toThrow();
  });
});
