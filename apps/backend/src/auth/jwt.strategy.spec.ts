import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/roles.js';
import { DenylistService } from '../redis/denylist.service.js';
import { UserAccessService } from '../users/user-access.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  const userAccessMock = { getAccess: vi.fn() };
  const userAccess = userAccessMock as unknown as UserAccessService;

  const build = (isDenied: boolean) =>
    new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      {
        isDenied: vi.fn().mockResolvedValue(isDenied),
      } as unknown as DenylistService,
      userAccess,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    userAccessMock.getAccess.mockResolvedValue({
      status: 1,
      role: UserRole.User,
    });
  });

  it('黑名单中的 jti 抛 UnauthorizedException，且不查用户访问快照', async () => {
    await expect(
      build(true).validate({ sub: '1', jti: 'bad' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(userAccessMock.getAccess).not.toHaveBeenCalled();
  });

  it('正常 jti 返回 userId、jti 与 role', async () => {
    await expect(
      build(false).validate({ sub: '1', jti: 'ok' }),
    ).resolves.toEqual({ userId: '1', jti: 'ok', role: UserRole.User });
    expect(userAccessMock.getAccess).toHaveBeenCalledWith('1');
  });

  it('admin 角色透传到返回值', async () => {
    userAccessMock.getAccess.mockResolvedValue({
      status: 1,
      role: UserRole.Admin,
    });
    await expect(
      build(false).validate({ sub: '1', jti: 'ok' }),
    ).resolves.toEqual({ userId: '1', jti: 'ok', role: UserRole.Admin });
  });

  it('用户不存在或已禁用抛 UnauthorizedException', async () => {
    userAccessMock.getAccess.mockResolvedValue({
      status: 0,
      role: UserRole.User,
    });
    await expect(
      build(false).validate({ sub: '1', jti: 'ok' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
