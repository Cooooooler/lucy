import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { BusinessException } from '../common/exceptions/business.exception';
import { PasswordService } from '../password/password.service';
import { DenylistService } from '../redis/denylist.service';
import { RedisService } from '../redis/redis.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };
  const passwordService = { verify: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const redisService = { set: jest.fn(), del: jest.fn(), get: jest.fn() };
  const denylist = { add: jest.fn() };

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
    jest.clearAllMocks();
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
});
