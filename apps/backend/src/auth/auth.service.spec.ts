import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  };
  const passwordService = { verify: vi.fn() };
  const jwtService = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const redisService = { set: vi.fn(), del: vi.fn(), get: vi.fn() };
  const denylist = { add: vi.fn() };

  const user: User = {
    id: '1',
    username: 'alice',
    email: 'alice@x.com',
    passwordHash: 'hash',
    nickname: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: DenylistService, useValue: denylist },
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('login 成功返回双令牌', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    const result = await service.login({ account: 'alice', password: 'p' });
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe('alice');
    expect(
      (result.user as { passwordHash?: string }).passwordHash,
    ).toBeUndefined();
  });

  it('login 密码错误抛 40102', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(false);
    await expect(
      service.login({ account: 'alice', password: 'x' }),
    ).rejects.toThrow(BusinessException);
  });

  it('login 用户不存在也执行一次虚拟 verify 且抛 40102', async () => {
    usersService.findByUsername.mockResolvedValue(null);
    passwordService.verify.mockResolvedValue(false);
    await expect(
      service.login({ account: 'ghost', password: 'x' }),
    ).rejects.toThrow(BusinessException);
    expect(passwordService.verify).toHaveBeenCalledTimes(1);
    expect(passwordService.verify).toHaveBeenCalledWith(
      'x',
      expect.stringMatching(/^scrypt:16384:8:1:/),
    );
  });

  it('login email 走 findByEmail', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    await service.login({ account: 'alice@x.com', password: 'p' });
    expect(usersService.findByEmail).toHaveBeenCalledWith('alice@x.com');
  });

  it('refresh 无效 token 抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue(null);
    await expect(service.refresh('bad')).rejects.toThrow(BusinessException);
  });

  it('login 账号禁用抛异常', async () => {
    usersService.findByUsername.mockResolvedValue({ ...user, status: 0 });
    passwordService.verify.mockResolvedValue(true);
    await expect(
      service.login({ account: 'alice', password: 'p' }),
    ).rejects.toThrow(BusinessException);
  });

  it('refresh 成功轮换令牌并删除旧 refresh key', async () => {
    redisService.get.mockResolvedValue('1');
    usersService.findById.mockResolvedValue(user);
    const result = await service.refresh('old');
    expect(redisService.del).toHaveBeenCalledWith('auth:refresh:old');
    expect(redisService.set).toHaveBeenCalledWith(
      `auth:refresh:${result.refreshToken}`,
      '1',
      expect.any(Number),
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('old');
  });

  it('refresh 用户不存在抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue('1');
    usersService.findById.mockResolvedValue(null);
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('refresh 用户已禁用抛 Unauthorized', async () => {
    redisService.get.mockResolvedValue('1');
    usersService.findById.mockResolvedValue({ ...user, status: 0 });
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('me 返回用户信息', async () => {
    usersService.findById.mockResolvedValue(user);
    await expect(service.me('1')).resolves.toEqual(
      expect.objectContaining({ id: '1', username: 'alice' }),
    );
    expect(
      (await service.me('1')) as unknown as { passwordHash?: string },
    ).not.toHaveProperty('passwordHash');
    const result = await service.me('1');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('me 用户不存在抛 Unauthorized', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(service.me('x')).rejects.toThrow(BusinessException);
  });

  it('logout 无 refreshToken 仅加入 denylist', async () => {
    await service.logout('jti-1');
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('logout 带 refreshToken 同时删除 redis key', async () => {
    await service.logout('jti-1', 'r');
    expect(redisService.del).toHaveBeenCalledWith('auth:refresh:r');
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
  });

  it('throwMissingRefresh 抛 BusinessException', () => {
    expect(() => service.throwMissingRefresh()).toThrow(BusinessException);
  });

  it('refreshTtl 返回默认 7 天', () => {
    expect(service.refreshTtl()).toBe(604800);
  });
});
