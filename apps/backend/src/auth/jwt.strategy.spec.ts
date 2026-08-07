import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenylistService } from '../redis/denylist.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  it('黑名单中的 jti 抛 UnauthorizedException', async () => {
    const denylist = {
      isDenied: vi.fn().mockResolvedValue(true),
    } as unknown as DenylistService;
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: 'secret' }),
      denylist,
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
    );
    await expect(strategy.validate({ sub: '1', jti: 'ok' })).resolves.toEqual({
      userId: '1',
      jti: 'ok',
    });
  });
});
