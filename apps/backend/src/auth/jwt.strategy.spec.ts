import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenylistService } from '../redis/denylist.service.js';
import { UsersService } from '../users/users.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  const usersService = {
    findById: vi.fn().mockResolvedValue({ id: '1', status: 1 }),
  } as unknown as UsersService;

  it('黑名单中的 jti 抛 UnauthorizedException', async () => {
    const denylist = {
      isDenied: vi.fn().mockResolvedValue(true),
    } as unknown as DenylistService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
      usersService,
    );
    await expect(strategy.validate({ sub: '1', jti: 'bad' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('正常 jti 返回 userId 与 jti', async () => {
    const denylist = {
      isDenied: vi.fn().mockResolvedValue(false),
    } as unknown as DenylistService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
      usersService,
    );
    await expect(strategy.validate({ sub: '1', jti: 'ok' })).resolves.toEqual({
      userId: '1',
      jti: 'ok',
    });
  });

  it('用户不存在或已禁用抛 UnauthorizedException', async () => {
    const denylist = {
      isDenied: vi.fn().mockResolvedValue(false),
    } as unknown as DenylistService;
    const gone = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
      gone,
    );
    await expect(strategy.validate({ sub: '1', jti: 'ok' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
