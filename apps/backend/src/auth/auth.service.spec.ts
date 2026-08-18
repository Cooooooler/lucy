import { RedisService } from '@coool/redis-nest';
import { ErrorCode } from '@lucy/shared';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
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
  // multi 事务链：set/sadd/expire/del/srem 均可链式追加，exec 结束事务
  const multi = {
    set: vi.fn().mockReturnThis(),
    sadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    srem: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  const redisService = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    expire: vi.fn(),
    raw: { multi: vi.fn(() => multi) },
  };
  const denylist = { add: vi.fn() };

  const user: User = {
    id: 'u1',
    username: 'alice',
    email: 'alice@x.com',
    passwordHash: 'hash',
    nickname: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const activeVal = `${user.id}:family-1`;

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

  it('login 成功返回用户、短效与长效 token', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    const result = await service.login({ account: 'alice', password: 'p' });
    expect(result.user.username).toBe('alice');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(
      (result.user as { passwordHash?: string }).passwordHash,
    ).toBeUndefined();
    expect(multi.set).toHaveBeenCalledWith(
      `auth:refresh:${result.refreshToken}`,
      expect.stringMatching(/^u1:/),
      'EX',
      expect.any(Number),
    );
    expect(multi.set).toHaveBeenCalledWith(
      `auth:refresh:at:${result.refreshToken}`,
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(multi.sadd).toHaveBeenCalled();
    expect(multi.expire).toHaveBeenCalled();
    expect(multi.exec).toHaveBeenCalled();
  });

  it('login 签发 access 失败时不落 refresh 状态', async () => {
    usersService.findByUsername.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    jwtService.signAsync.mockRejectedValueOnce(new Error('sign failed'));
    await expect(
      service.login({ account: 'alice', password: 'p' }),
    ).rejects.toThrow('sign failed');
    expect(redisService.raw.multi).not.toHaveBeenCalled();
    expect(multi.exec).not.toHaveBeenCalled();
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
  });

  it('login email 走 findByEmail', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    await service.login({ account: 'alice@x.com', password: 'p' });
    expect(usersService.findByEmail).toHaveBeenCalledWith('alice@x.com');
  });

  it('login 账号禁用抛异常', async () => {
    usersService.findByUsername.mockResolvedValue({ ...user, status: 0 });
    passwordService.verify.mockResolvedValue(true);
    await expect(
      service.login({ account: 'alice', password: 'p' }),
    ).rejects.toThrow(BusinessException);
  });

  // 按 key 返回值的 get mock，避免用单一返回值掩盖 active/at/reuse 读取
  function mockGet(map: Record<string, string | null>): void {
    redisService.get.mockImplementation((key: string) =>
      Promise.resolve(map[key] ?? null),
    );
  }

  // 断言拒绝且业务码为 UNAUTHORIZED（40101）
  function expectUnauthorized(p: Promise<unknown>): Promise<void> {
    return p.then(
      () => Promise.reject(new Error('expected rejection')),
      (e: unknown) => {
        expect((e as { getResponse?: () => unknown }).getResponse?.()).toEqual(
          expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
        );
      },
    );
  }

  it('refresh 未到轮换年龄时不轮换，返回同一 refresh token', async () => {
    mockGet({
      'auth:refresh:old': activeVal,
      'auth:refresh:at:old': String(Date.now()),
    });
    usersService.findById.mockResolvedValue(user);
    const result = await service.refresh('old');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('old');
    expect(redisService.raw.multi).not.toHaveBeenCalled();
  });

  it('refresh 超过轮换年龄时轮换：删旧 key、srem、写复用标记、同家族新增', async () => {
    const now = Date.now();
    mockGet({
      'auth:refresh:old': activeVal,
      'auth:refresh:at:old': String(now - 600001),
    });
    usersService.findById.mockResolvedValue(user);
    const result = await service.refresh('old');
    expect(multi.del).toHaveBeenCalledWith(
      'auth:refresh:old',
      'auth:refresh:at:old',
    );
    expect(multi.srem).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
      'old',
    );
    expect(multi.set).toHaveBeenCalledWith(
      'auth:refresh:reuse:old',
      activeVal,
      'EX',
      expect.any(Number),
    );
    expect(multi.set).toHaveBeenCalledWith(
      'auth:refresh:reuse-at:old',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(multi.set).toHaveBeenCalledWith(
      `auth:refresh:${result.refreshToken}`,
      activeVal,
      'EX',
      expect.any(Number),
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('old');
  });

  it('refresh 复用 token 但在宽限期内视为良性，不吊销家族', async () => {
    const now = Date.now();
    mockGet({
      'auth:refresh:old': null,
      'auth:refresh:reuse:old': activeVal,
      'auth:refresh:reuse-at:old': String(now - 5000),
    });
    await expect(service.refresh('old')).rejects.toThrow(BusinessException);
    expect(redisService.smembers).not.toHaveBeenCalled();
    expect(redisService.raw.multi).not.toHaveBeenCalled();
  });

  it('refresh 复用 token 且超过宽限期判定泄露，吊销整个家族', async () => {
    const now = Date.now();
    mockGet({
      'auth:refresh:old': null,
      'auth:refresh:reuse:old': activeVal,
      'auth:refresh:reuse-at:old': String(now - 20000),
    });
    redisService.smembers.mockResolvedValue(['t1', 't2']);
    await expectUnauthorized(service.refresh('old'));
    expect(redisService.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
    expect(multi.del).toHaveBeenCalledWith(
      'auth:refresh:t1',
      'auth:refresh:at:t1',
      'auth:refresh:reuse:t1',
      'auth:refresh:reuse-at:t1',
    );
  });

  it('refresh 复用记录存在但 reuse-at 缺失时 fail-closed 吊销家族', async () => {
    mockGet({
      'auth:refresh:old': null,
      'auth:refresh:reuse:old': activeVal,
      'auth:refresh:reuse-at:old': null,
    });
    redisService.smembers.mockResolvedValue(['t1']);
    await expectUnauthorized(service.refresh('old'));
    expect(redisService.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
  });

  it('refresh 无效 token（非复用）抛 Unauthorized', async () => {
    mockGet({});
    await expectUnauthorized(service.refresh('bad'));
    expect(redisService.smembers).not.toHaveBeenCalled();
  });

  it('refresh 遇到旧格式（无 family）的 active 值视为无效并清理', async () => {
    mockGet({ 'auth:refresh:old': 'u1' }); // 旧格式：只有 userId
    await expect(service.refresh('old')).rejects.toThrow(BusinessException);
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:refresh:old',
      'auth:refresh:at:old',
      'auth:refresh:reuse:old',
      'auth:refresh:reuse-at:old',
    );
    expect(redisService.sadd).not.toHaveBeenCalled();
  });

  it('refresh 用户不存在抛 Unauthorized', async () => {
    mockGet({ 'auth:refresh:t': activeVal });
    usersService.findById.mockResolvedValue(null);
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('refresh 用户已禁用抛 Unauthorized', async () => {
    mockGet({ 'auth:refresh:t': activeVal });
    usersService.findById.mockResolvedValue({ ...user, status: 0 });
    await expect(service.refresh('t')).rejects.toThrow(BusinessException);
  });

  it('me 返回用户信息且不含 passwordHash', async () => {
    usersService.findById.mockResolvedValue(user);
    const result = await service.me('1');
    expect(result).toEqual(expect.objectContaining({ id: 'u1' }));
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('me 用户不存在抛 Unauthorized', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(service.me('x')).rejects.toThrow(BusinessException);
  });

  it('logout 带有效 refreshToken 吊销整个家族', async () => {
    mockGet({ 'auth:refresh:r': activeVal });
    redisService.smembers.mockResolvedValue(['t1']);
    await service.logout('jti-1', 'r');
    expect(redisService.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
    expect(multi.del).toHaveBeenCalledWith(
      'auth:refresh:t1',
      'auth:refresh:at:t1',
      'auth:refresh:reuse:t1',
      'auth:refresh:reuse-at:t1',
    );
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
  });

  it('logout 无 refreshToken 仅加入 denylist', async () => {
    await service.logout('jti-1');
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('logout 带已轮换 token 时从 reuse 解析 family 并撤销整个家族', async () => {
    mockGet({
      'auth:refresh:r': null,
      'auth:refresh:reuse:r': activeVal,
    });
    redisService.smembers.mockResolvedValue(['t1']);
    await service.logout('jti-1', 'r');
    expect(redisService.smembers).toHaveBeenCalledWith(
      'auth:refresh:family:family-1',
    );
    expect(denylist.add).toHaveBeenCalledWith('jti-1');
  });

  it('throwMissingRefresh 抛 BusinessException', () => {
    expect(() => service.throwMissingRefresh()).toThrow(BusinessException);
  });

  it('refreshTtl 返回默认 7 天', () => {
    expect(service.refreshTtl()).toBe(604800);
  });

  it('rotationMs 默认 10 分钟', () => {
    expect(service.rotationMs()).toBe(600000);
  });

  it('reuseGraceSeconds 默认 10 秒', () => {
    expect(service.reuseGraceSeconds()).toBe(10);
  });
});
