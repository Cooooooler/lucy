import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe.js';
import { LoginDto } from './login.dto.js';

/**
 * 经真实全局管道（`createValidationPipe` 与 `CommonModule` 的 `APP_PIPE` 同一份配置）
 * 驱动，而不是只断言装饰器元数据。
 *
 * 这里钉住的是一条容易被人「顺手改坏」的不变式：account 要 trim、password **不能** trim。
 * 密码一旦 trim，旧版注册正则（无 `$` 锚定）入库的含首尾空白密码将永远 401，
 * 而本仓库没有改密/重置入口 —— 这不是纯风格问题，所以必须有测试守着。
 */
describe('LoginDto 经全局 ValidationPipe', () => {
  const pipe = createValidationPipe();

  const throughPipe = (value: unknown): Promise<LoginDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: LoginDto,
    }) as Promise<LoginDto>;

  it('account 首尾空白被 trim', async () => {
    const dto = await throughPipe({ account: '  lucy  ', password: 'Pass1!' });
    expect(dto.account).toBe('lucy');
  });

  it('account 纯空白串被 400（@IsNotEmpty 本身放行纯空白，靠 trim 收口）', async () => {
    await expect(
      throughPipe({ account: '    ', password: 'Pass1!' }),
    ).rejects.toThrow();
  });

  it('password 刻意不 trim：存量含首尾空白的密码必须仍能登录', async () => {
    const dto = await throughPipe({
      account: 'lucy',
      password: ' Pass1! ',
    });
    expect(dto.password).toBe(' Pass1! ');
  });

  it('account 超过上界被 400', async () => {
    await expect(
      throughPipe({ account: 'a'.repeat(256), password: 'Pass1!' }),
    ).rejects.toThrow();
  });

  it('password 超过上界被 400', async () => {
    await expect(
      throughPipe({ account: 'lucy', password: 'a'.repeat(73) }),
    ).rejects.toThrow();
  });

  it('非白名单字段被 400（依赖线上的 forbidNonWhitelisted）', async () => {
    await expect(
      throughPipe({ account: 'lucy', password: 'Pass1!', isAdmin: true }),
    ).rejects.toThrow();
  });
});
