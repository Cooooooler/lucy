import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenylistService } from '../redis/denylist.service.js';
import { UserStatusService } from '../users/user-status.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  const userStatusMock = { isActive: vi.fn() };
  const userStatus = userStatusMock as unknown as UserStatusService;

  const build = (isDenied: boolean) =>
    new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      {
        isDenied: vi.fn().mockResolvedValue(isDenied),
      } as unknown as DenylistService,
      userStatus,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    userStatusMock.isActive.mockResolvedValue(true);
  });

  it('黑名单中的 jti 抛 UnauthorizedException，且不查用户状态', async () => {
    await expect(
      build(true).validate({ sub: '1', jti: 'bad' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(userStatusMock.isActive).not.toHaveBeenCalled();
  });

  it('正常 jti 返回 userId 与 jti', async () => {
    await expect(
      build(false).validate({ sub: '1', jti: 'ok' }),
    ).resolves.toEqual({ userId: '1', jti: 'ok' });
    expect(userStatusMock.isActive).toHaveBeenCalledWith('1');
  });

  it('用户不存在或已禁用抛 UnauthorizedException', async () => {
    userStatusMock.isActive.mockResolvedValue(false);
    await expect(
      build(false).validate({ sub: '1', jti: 'ok' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
