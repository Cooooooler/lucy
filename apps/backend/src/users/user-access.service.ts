import { RedisService } from '@coool/redis-nest';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/app-logger.service.js';
import { UserRole } from './user.entity.js';
import { UsersRepository } from './users.repository.js';

/** 认证所需的用户访问快照：可用状态 + 角色 */
export interface UserAccess {
  status: number;
  role: UserRole;
}

/**
 * 用户访问快照缓存：为每请求鉴权提供 O(1) 判定，避免每个已认证请求都打一次 users 表。
 * 仅缓存「是否可用 + 角色」这两个鉴权事实，不缓存用户实体——避免 passwordHash 等
 * 敏感字段落 Redis，也避免档案字段陈旧。
 *
 * 语义：Redis 命中直接返回；未命中回源 DB 并写入短 TTL；Redis 故障时回退查库
 * （DB 才是事实源），不因缓存不可用阻断认证。用户不存在时返回 status=0 并缓存，
 * 使 401 路径同样不反复打库。
 */
@Injectable()
export class UserAccessService {
  private static readonly KEY_PREFIX = 'auth:user-access:';

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 缓存 TTL（秒）：越短越接近「变更立即生效」，越长对 DB 保护越好。 */
  private get ttlSeconds(): number {
    return this.config.get<number>('USER_STATUS_CACHE_TTL_SECONDS', 30);
  }

  private key(userId: string): string {
    return `${UserAccessService.KEY_PREFIX}${userId}`;
  }

  /** 取用户访问快照；用户不存在时返回 status=0 的快照。 */
  async getAccess(userId: string): Promise<UserAccess> {
    const cached = await this.readCache(userId);
    if (cached !== null) return cached;
    const access = (await this.usersRepo.findAccessById(userId)) ?? {
      status: 0,
      role: UserRole.User,
    };
    await this.writeCache(userId, access);
    return access;
  }

  /** 状态/角色变更后主动失效缓存，使变更立即生效（TTL 仅作兜底）。 */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.del(this.key(userId));
    } catch (err) {
      // 失效失败不抛错：DB 已变更，缓存最迟在 TTL 后自然过期
      this.logger.warn(
        `user access cache invalidate failed: ${String(err)}`,
        UserAccessService.name,
      );
    }
  }

  private async readCache(userId: string): Promise<UserAccess | null> {
    try {
      const cached = await this.redis.getJson<UserAccess>(this.key(userId));
      // 结构不符（含历史遗留的非对象值）视为未命中，回源 DB
      if (!cached || typeof cached.status !== 'number') return null;
      return cached;
    } catch (err) {
      this.logger.warn(
        `user access cache read failed, fallback to db: ${String(err)}`,
        UserAccessService.name,
      );
      return null;
    }
  }

  private async writeCache(userId: string, access: UserAccess): Promise<void> {
    try {
      await this.redis.setJson(this.key(userId), access, this.ttlSeconds);
    } catch (err) {
      // 写缓存失败不影响本次判定结果，下次请求回源重试
      this.logger.warn(
        `user access cache write failed: ${String(err)}`,
        UserAccessService.name,
      );
    }
  }
}
