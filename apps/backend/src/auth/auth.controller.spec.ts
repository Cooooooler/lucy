import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    throwMissingRefresh: jest.fn(),
    refreshTtl: jest.fn().mockReturnValue(604800),
  };

  const safeUser = {
    id: '1',
    username: 'alice',
    email: 'alice@x.com',
    nickname: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const resMock = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  const res = resMock as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('register 委托 authService.register 并返回 User', async () => {
    authService.register.mockResolvedValue(safeUser);
    const dto = {
      username: 'alice',
      email: 'alice@x.com',
      password: 'p',
      nickname: 'A',
    };
    await expect(controller.register(dto)).resolves.toBe(safeUser);
    expect(authService.register).toHaveBeenCalledWith(dto);
  });

  it('login 写入 httpOnly refresh cookie 并返回双令牌', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', user: safeUser };
    authService.login.mockResolvedValue(tokens);
    const dto = { account: 'alice', password: 'p' };
    await expect(controller.login(dto, res)).resolves.toBe(tokens);
    expect(resMock.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'r',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 604800 * 1000,
      }),
    );
  });

  it('refresh 优先使用 body 里的 refreshToken', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r' };
    authService.refresh.mockResolvedValue(tokens);
    const dto = { refreshToken: 'body-token' };
    const req = {
      cookies: { refreshToken: 'cookie-token' },
    } as unknown as Request;
    await expect(controller.refresh(dto, req, res)).resolves.toBe(tokens);
    expect(authService.refresh).toHaveBeenCalledWith('body-token');
  });

  it('refresh 无 body token 时兜底读取 cookie', async () => {
    authService.refresh.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
    });
    const dto = { refreshToken: undefined };
    const req = {
      cookies: { refreshToken: 'cookie-token' },
    } as unknown as Request;
    await controller.refresh(dto, req, res);
    expect(authService.refresh).toHaveBeenCalledWith('cookie-token');
  });

  it('refresh 缺少 token 委托 throwMissingRefresh', async () => {
    authService.throwMissingRefresh.mockImplementation(() => {
      throw new Error('missing');
    });
    const dto = { refreshToken: undefined };
    const req = { cookies: {} } as unknown as Request;
    await expect(controller.refresh(dto, req, res)).rejects.toThrow('missing');
    expect(authService.throwMissingRefresh).toHaveBeenCalled();
  });

  it('logout 删除 redis key、清除 cookie 并返回 success', async () => {
    authService.logout.mockResolvedValue(undefined);
    const user = { userId: '1', jti: 'jti-1' };
    const dto = { refreshToken: 'r' };
    const req = { cookies: {} } as unknown as Request;
    await expect(controller.logout(user, dto, req, res)).resolves.toEqual({
      success: true,
    });
    expect(authService.logout).toHaveBeenCalledWith('jti-1', 'r');
    expect(resMock.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.any(Object),
    );
  });

  it('me 返回当前用户信息', async () => {
    authService.me.mockResolvedValue(safeUser);
    const user = { userId: '1', jti: 'jti-1' };
    await expect(controller.me(user)).resolves.toBe(safeUser);
    expect(authService.me).toHaveBeenCalledWith('1');
  });
});
