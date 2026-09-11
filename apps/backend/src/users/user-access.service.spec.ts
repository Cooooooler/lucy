import type { RedisService } from '@coool/redis-nest';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/app-logger.service.js';
import { UserRole } from '../common/roles.js';
import { UserAccessService } from './user-access.service.js';
import type { UsersRepository } from './users.repository.js';

describe('UserAccessService', () => {
  const usersRepo = { findAccessById: vi.fn() };
  const redis = { getJson: vi.fn(), setJson: vi.fn(), del: vi.fn() };
  const logger = { warn: vi.fn() };

  function build(ttl = 30): UserAccessService {
    return new UserAccessService(
      usersRepo as unknown as UsersRepository,
      redis as unknown as RedisService,
      new ConfigService({ USER_STATUS_CACHE_TTL_SECONDS: ttl }),
      logger as unknown as AppLogger,
    );
  }

  beforeEach(() => vi.clearAllMocks());

  it('缓存命中直接返回，不查库', async () => {
    redis.getJson.mockResolvedValue({ status: 1, role: UserRole.Admin });
    await expect(build().getAccess('u1')).resolves.toEqual({
      status: 1,
      role: UserRole.Admin,
    });
    expect(usersRepo.findAccessById).not.toHaveBeenCalled();
  });

  it('缓存未命中回源查库，并写入带 TTL 的缓存', async () => {
    redis.getJson.mockResolvedValue(null);
    usersRepo.findAccessById.mockResolvedValue({
      status: 1,
      role: UserRole.User,
    });
    await expect(build(60).getAccess('u1')).resolves.toEqual({
      status: 1,
      role: UserRole.User,
    });
    expect(usersRepo.findAccessById).toHaveBeenCalledWith('u1');
    expect(redis.setJson).toHaveBeenCalledWith(
      'auth:user-access:u1',
      {
        status: 1,
        role: UserRole.User,
      },
      60,
    );
  });

  it('用户不存在时返回 status=0 并缓存，避免每次请求都回源', async () => {
    redis.getJson.mockResolvedValue(null);
    usersRepo.findAccessById.mockResolvedValue(null);
    await expect(build().getAccess('u1')).resolves.toEqual({
      status: 0,
      role: UserRole.User,
    });
    expect(redis.setJson).toHaveBeenCalledWith(
      'auth:user-access:u1',
      { status: 0, role: UserRole.User },
      30,
    );
  });

  it('缓存结构不符（如历史遗留的非对象值）视为未命中并回源', async () => {
    redis.getJson.mockResolvedValue(1);
    usersRepo.findAccessById.mockResolvedValue({
      status: 1,
      role: UserRole.User,
    });
    await expect(build().getAccess('u1')).resolves.toEqual({
      status: 1,
      role: UserRole.User,
    });
    expect(usersRepo.findAccessById).toHaveBeenCalledWith('u1');
  });

  it('Redis 读失败时回退查库且不抛错', async () => {
    redis.getJson.mockRejectedValue(new Error('redis down'));
    usersRepo.findAccessById.mockResolvedValue({
      status: 1,
      role: UserRole.User,
    });
    await expect(build().getAccess('u1')).resolves.toEqual({
      status: 1,
      role: UserRole.User,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('缓存写失败不影响判定结果', async () => {
    redis.getJson.mockResolvedValue(null);
    usersRepo.findAccessById.mockResolvedValue({
      status: 1,
      role: UserRole.User,
    });
    redis.setJson.mockRejectedValue(new Error('redis down'));
    await expect(build().getAccess('u1')).resolves.toEqual({
      status: 1,
      role: UserRole.User,
    });
  });

  it('invalidate 删除对应 key', async () => {
    await build().invalidate('u1');
    expect(redis.del).toHaveBeenCalledWith('auth:user-access:u1');
  });

  it('invalidate 失败时吞掉异常并告警', async () => {
    redis.del.mockRejectedValue(new Error('redis down'));
    await expect(build().invalidate('u1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
