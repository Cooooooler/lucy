import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    throwMissingRefresh: vi.fn(),
    refreshTtl: vi.fn().mockReturnValue(604800),
    cookieSecure: vi.fn().mockReturnValue(false),
  };

  const safeUser = {
    id: '1',
    username: 'alice',
    email: 'alice@x.com',
    nickname: null,
    status: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  const resMock = { cookie: vi.fn(), clearCookie: vi.fn() };
  const res = resMock as unknown as Response;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('login 写 httpOnly refresh cookie 并只返回 user', async () => {
    authService.login.mockResolvedValue({
      user: safeUser,
      refreshToken: 'r',
    });
    const dto = { account: 'alice', password: 'p' };
    await expect(controller.login(dto, res)).resolves.toEqual({
      user: safeUser,
    });
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

  it('refresh 只读 cookie，返回 { accessToken } 并重设 cookie', async () => {
    authService.refresh.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r2',
    });
    const req = {
      cookies: { refreshToken: 'cookie-token' },
    } as unknown as Request;
    await expect(controller.refresh(req, res)).resolves.toEqual({
      accessToken: 'a',
    });
    expect(authService.refresh).toHaveBeenCalledWith('cookie-token');
    expect(resMock.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'r2',
      expect.any(Object),
    );
  });

  it('refresh 缺少 cookie 委托 throwMissingRefresh', async () => {
    authService.throwMissingRefresh.mockImplementation(() => {
      throw new Error('missing');
    });
    const req = { cookies: {} } as unknown as Request;
    await expect(controller.refresh(req, res)).rejects.toThrow('missing');
    expect(authService.throwMissingRefresh).toHaveBeenCalled();
  });

  it('logout 读 cookie 吊销家族、清除 cookie 并返回 success', async () => {
    authService.logout.mockResolvedValue(undefined);
    const user = { userId: '1', jti: 'jti-1' };
    const req = { cookies: { refreshToken: 'r' } } as unknown as Request;
    await expect(controller.logout(user, req, res)).resolves.toEqual({
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
