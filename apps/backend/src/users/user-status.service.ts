import { RedisService } from '@coool/redis-nest';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/app-logger.service.js';
import { UsersRepository } from './users.repository.js';

/**
 * 用户可用性（status）缓存：为每请求的认证校验提供 O(1) 判定，避免每个已认证请求
 * 都打一次 users 表。仅缓存「是否可用」这一布尔事实，不缓存用户实体——避免
 * passwordHash 等敏感字段落 Redis，也避免档案字段陈旧。
 *
 * 语义：Redis 命中直接返回；未命中回源 DB 的 status 列并写入短 TTL；Redis 故障时
 * 回退查库（DB 才是事实源），不因缓存不可用阻断认证。
 */
@Injectable()
export class UserStatusService {
  private static readonly KEY_PREFIX = 'auth:user-status:';
  private static readonly ACTIVE = '1';
  private static readonly INACTIVE = '0';

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 缓存 TTL（秒）：越短越接近「立即失效」，越长对 DB 保护越好。 */
  private get ttlSeconds(): number {
    return this.config.get<number>('USER_STATUS_CACHE_TTL_SECONDS', 30);
  }

  private key(userId: string): string {
    return `${UserStatusService.KEY_PREFIX}${userId}`;
  }

  /** 用户是否存在且可用（status=1）。 */
  async isActive(userId: string): Promise<boolean> {
    const cached = await this.readCache(userId);
    if (cached !== null) return cached;
    const active = (await this.usersRepo.findStatusById(userId)) === 1;
    await this.writeCache(userId, active);
    return active;
  }

  /** 状态变更后主动失效缓存，使禁用/删除立即生效（TTL 仅作兜底）。 */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.del(this.key(userId));
    } catch (err) {
      // 失效失败不抛错：DB 已变更，缓存最迟在 TTL 后自然过期
      this.logger.warn(
        `user status cache invalidate failed: ${String(err)}`,
        UserStatusService.name,
      );
    }
  }

  private async readCache(userId: string): Promise<boolean | null> {
    try {
      const value = await this.redis.get(this.key(userId));
      return value === null ? null : value === UserStatusService.ACTIVE;
    } catch (err) {
      this.logger.warn(
        `user status cache read failed, fallback to db: ${String(err)}`,
        UserStatusService.name,
      );
      return null;
    }
  }

  private async writeCache(userId: string, active: boolean): Promise<void> {
    try {
      await this.redis.set(
        this.key(userId),
        active ? UserStatusService.ACTIVE : UserStatusService.INACTIVE,
        this.ttlSeconds,
      );
    } catch (err) {
      // 写缓存失败不影响本次判定结果，下次请求回源重试
      this.logger.warn(
        `user status cache write failed: ${String(err)}`,
        UserStatusService.name,
      );
    }
  }
}
