import type { RedisService } from '@coool/redis-nest';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/app-logger.service.js';
import { UserStatusService } from './user-status.service.js';
import type { UsersRepository } from './users.repository.js';

describe('UserStatusService', () => {
  const usersRepo = { findStatusById: vi.fn() };
  const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
  const logger = { warn: vi.fn() };

  function build(ttl = 30): UserStatusService {
    return new UserStatusService(
      usersRepo as unknown as UsersRepository,
      redis as unknown as RedisService,
      new ConfigService({ USER_STATUS_CACHE_TTL_SECONDS: ttl }),
      logger as unknown as AppLogger,
    );
  }

  beforeEach(() => vi.clearAllMocks());

  it('缓存命中可用时不查库', async () => {
    redis.get.mockResolvedValue('1');
    await expect(build().isActive('u1')).resolves.toBe(true);
    expect(usersRepo.findStatusById).not.toHaveBeenCalled();
  });

  it('缓存命中不可用时返回 false', async () => {
    redis.get.mockResolvedValue('0');
    await expect(build().isActive('u1')).resolves.toBe(false);
    expect(usersRepo.findStatusById).not.toHaveBeenCalled();
  });

  it('缓存未命中回源查库，并写入带 TTL 的缓存', async () => {
    redis.get.mockResolvedValue(null);
    usersRepo.findStatusById.mockResolvedValue(1);
    await expect(build(60).isActive('u1')).resolves.toBe(true);
    expect(usersRepo.findStatusById).toHaveBeenCalledWith('u1');
    expect(redis.set).toHaveBeenCalledWith('auth:user-status:u1', '1', 60);
  });

  it('用户不存在时缓存 false，避免每次请求都回源', async () => {
    redis.get.mockResolvedValue(null);
    usersRepo.findStatusById.mockResolvedValue(null);
    await expect(build().isActive('u1')).resolves.toBe(false);
    expect(redis.set).toHaveBeenCalledWith('auth:user-status:u1', '0', 30);
  });

  it('Redis 读失败时回退查库且不抛错', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    usersRepo.findStatusById.mockResolvedValue(1);
    await expect(build().isActive('u1')).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('缓存写失败不影响判定结果', async () => {
    redis.get.mockResolvedValue(null);
    usersRepo.findStatusById.mockResolvedValue(1);
    redis.set.mockRejectedValue(new Error('redis down'));
    await expect(build().isActive('u1')).resolves.toBe(true);
  });

  it('invalidate 删除对应 key', async () => {
    await build().invalidate('u1');
    expect(redis.del).toHaveBeenCalledWith('auth:user-status:u1');
  });

  it('invalidate 失败时吞掉异常并告警', async () => {
    redis.del.mockRejectedValue(new Error('redis down'));
    await expect(build().invalidate('u1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
