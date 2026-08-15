import type { components } from '@lucy/shared';
import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';

// API 契约类型由 Swagger 生成的 components.schemas 派生，与前端共享同一事实源
type SharedUser = components['schemas']['User'];

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly denylist: DenylistService,
    private readonly config: ConfigService,
  ) {}

  refreshTtl(): number {
    return this.config.get<number>('REFRESH_TTL_SECONDS', 604800);
  }

  cookieSecure(): boolean {
    return this.config.get<string>('NODE_ENV', 'development') === 'production';
  }

  // 旧格式/损坏的 active 值（无 family 或空段）返回 null，避免归入共享 family:undefined 命名空间
  private parseActive(
    value: string | null,
  ): { userId: string; family: string } | null {
    if (!value) return null;
    const sep = value.indexOf(':');
    if (sep <= 0 || sep === value.length - 1) return null;
    return { userId: value.slice(0, sep), family: value.slice(sep + 1) };
  }

  private refreshKey(token: string): string {
    return `auth:refresh:${token}`;
  }

  private familyKey(family: string): string {
    return `auth:refresh:family:${family}`;
  }

  private reuseKey(token: string): string {
    return `auth:refresh:reuse:${token}`;
  }

  private toSharedUser(user: User): SharedUser {
    const { id, username, email, nickname, status, createdAt, updatedAt } =
      user;
    return {
      id,
      username,
      email,
      nickname,
      status,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  async register(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<SharedUser> {
    const user = await this.usersService.create(input);
    return this.toSharedUser(user);
  }

  async login(dto: {
    account: string;
    password: string;
  }): Promise<{ user: SharedUser; refreshToken: string }> {
    const user = dto.account.includes('@')
      ? await this.usersService.findByEmail(dto.account)
      : await this.usersService.findByUsername(dto.account);
    if (!user) {
      // 虚拟 verify：用户不存在时也执行一次 scrypt，抹平与密码错误路径的耗时差，防账号枚举
      await this.passwordService.verify(
        dto.password,
        'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      );
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        '用户名或密码错误',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!(await this.passwordService.verify(dto.password, user.passwordHash))) {
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        '用户名或密码错误',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status !== 1) {
      throw new BusinessException(
        ErrorCode.ACCOUNT_DISABLED,
        '账号已禁用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const family = randomUUID();
    const refreshToken = await this.issueRefreshToken(user.id, family);
    return { user: this.toSharedUser(user), refreshToken };
  }

  private async issueRefreshToken(
    userId: string,
    family: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(token),
      `${userId}:${family}`,
      this.refreshTtl(),
    );
    await this.redis.client.sadd(this.familyKey(family), token);
    await this.redis.client.expire(this.familyKey(family), this.refreshTtl());
    return token;
  }

  private async revokeFamily(family: string): Promise<void> {
    const members = await this.redis.client.smembers(this.familyKey(family));
    await Promise.all(
      members.map((t) => this.redis.del(this.refreshKey(t), this.reuseKey(t))),
    );
    await this.redis.del(this.familyKey(family));
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const active = await this.redis.get(this.refreshKey(refreshToken));
    if (!active) {
      // 已不在 active 集合：可能是被轮换掉的旧 token（复用=泄露信号），或已过期
      const reused = await this.redis.get(this.reuseKey(refreshToken));
      if (reused) {
        const parsed = this.parseActive(reused);
        if (parsed) {
          await this.revokeFamily(parsed.family);
        }
        throw new BusinessException(
          ErrorCode.UNAUTHORIZED,
          '刷新令牌无效（检测到令牌复用）',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const parsed = this.parseActive(active);
    if (!parsed) {
      // 旧格式或损坏记录：删除并视为无效，绝不写入 family:undefined
      await this.redis.del(
        this.refreshKey(refreshToken),
        this.reuseKey(refreshToken),
      );
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const { userId, family } = parsed;
    const user = await this.usersService.findById(userId);
    if (user?.status !== 1) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '账号不可用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // 轮换：删除旧 token → 记录复用标记 → 同家族签发新 token
    await this.redis.del(this.refreshKey(refreshToken));
    await this.redis.client.srem(this.familyKey(family), refreshToken);
    await this.redis.set(
      this.reuseKey(refreshToken),
      active,
      this.refreshTtl(),
    );
    const newRefreshToken = await this.issueRefreshToken(userId, family);
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(jti: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const active = await this.redis.get(this.refreshKey(refreshToken));
      const parsed = this.parseActive(active);
      if (parsed) {
        await this.revokeFamily(parsed.family);
      } else {
        await this.redis.del(
          this.refreshKey(refreshToken),
          this.reuseKey(refreshToken),
        );
      }
    }
    await this.denylist.add(jti);
  }

  async me(userId: string): Promise<SharedUser> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '用户不存在',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toSharedUser(user);
  }

  throwMissingRefresh(): never {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '缺少刷新令牌',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
