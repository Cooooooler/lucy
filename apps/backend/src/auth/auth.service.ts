import { RedisService } from '@coool/redis-nest';
import type { components } from '@lucy/shared';
import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ChainableCommander } from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { DenylistService } from '../redis/denylist.service.js';
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

  // 时间化轮换：refresh token 超过该年龄才轮换，否则保持同一 token（降低多标签页竞态）
  rotationMs(): number {
    return this.config.get<number>('REFRESH_ROTATION_MS', 600000);
  }

  // 复用宽限期：轮换后短时间内再次出现视为良性 cookie 滞后，超过才判定泄露
  reuseGraceSeconds(): number {
    return this.config.get<number>('REUSE_GRACE_SECONDS', 10);
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

  private activeAtKey(token: string): string {
    return `auth:refresh:at:${token}`;
  }

  private reuseAtKey(token: string): string {
    return `auth:refresh:reuse-at:${token}`;
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

  async login(dto: { account: string; password: string }): Promise<{
    user: SharedUser;
    accessToken: string;
    refreshToken: string;
  }> {
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
    // 先签 access token：signAsync 失败时不落任何 refresh 状态，避免泄漏无人可达的 Redis 记录
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    const refreshToken = await this.issueRefreshToken(user.id, family);
    return { user: this.toSharedUser(user), accessToken, refreshToken };
  }

  private async issueRefreshToken(
    userId: string,
    family: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const ttl = this.refreshTtl();
    // 四条写入并入单个事务，避免进程中途崩溃留下孤儿 token/family 记录
    await this.execMulti(
      this.redis.raw
        .multi()
        .set(this.refreshKey(token), `${userId}:${family}`, 'EX', ttl)
        .set(this.activeAtKey(token), String(Date.now()), 'EX', ttl)
        .sadd(this.familyKey(family), token)
        .expire(this.familyKey(family), ttl),
    );
    return token;
  }

  private async revokeFamily(family: string): Promise<void> {
    const members = await this.redis.smembers(this.familyKey(family));
    if (members.length === 0) {
      await this.redis.del(this.familyKey(family));
      return;
    }
    // 每个成员四条 key 删除 + family key 删除并入单事务，保证整个家族的撤销原子完成
    const tx = this.redis.raw.multi();
    for (const t of members) {
      tx.del(
        this.refreshKey(t),
        this.activeAtKey(t),
        this.reuseKey(t),
        this.reuseAtKey(t),
      );
    }
    tx.del(this.familyKey(family));
    await this.execMulti(tx);
  }

  // ioredis 的 exec() 对事务内单条命令失败不会 reject，而是以 [err, result] 数组逐条返回；
  // 忽略结果会静默部分写入（如 refresh 令牌已写但 family 未登记）。此方法校验所有结果，
  // 任一命令失败即抛错，保证整个事务要么全部成功、要么按失败处理。
  private async execMulti(tx: ChainableCommander): Promise<void> {
    const results = await tx.exec();
    // 事务为空（无命令排队）时 exec 返回 null，无结果可校验
    if (!results) return;
    const failed = results.find(([err]) => err)?.[0];
    if (failed) {
      throw new Error(`Redis transaction failed: ${failed.message}`);
    }
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const active = await this.redis.get(this.refreshKey(refreshToken));
    if (!active) {
      throw await this.handleInactiveRefreshToken(refreshToken);
    }
    const parsed = this.parseActive(active);
    if (!parsed) {
      // 旧格式或损坏记录：删除并视为无效，绝不写入 family:undefined
      await this.redis.del(
        this.refreshKey(refreshToken),
        this.activeAtKey(refreshToken),
        this.reuseKey(refreshToken),
        this.reuseAtKey(refreshToken),
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
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    return this.maybeRotate(refreshToken, userId, family, active, accessToken);
  }

  // 已不在 active 集合：可能是被轮换掉的旧 token，或已过期
  private async handleInactiveRefreshToken(
    refreshToken: string,
  ): Promise<BusinessException> {
    const reused = await this.redis.get(this.reuseKey(refreshToken));
    if (!reused) {
      return new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const parsed = this.parseActive(reused);
    const theft = await this.detectTheft(refreshToken, parsed);
    if (theft && parsed) {
      await this.revokeFamily(parsed.family);
    }
    return new BusinessException(
      ErrorCode.UNAUTHORIZED,
      theft ? '刷新令牌无效（检测到令牌复用）' : '刷新令牌无效',
      HttpStatus.UNAUTHORIZED,
    );
  }

  // 复用宽限期：仅当 reuse-at 存在且在宽限期内视为良性 cookie 滞后（多标签页竞态）；
  // reuse-at 缺失或超过宽限期均按泄露处理（fail-closed）
  private async detectTheft(
    refreshToken: string,
    parsed: { userId: string; family: string } | null,
  ): Promise<boolean> {
    if (!parsed) return false;
    const reuseAtRaw = await this.redis.get(this.reuseAtKey(refreshToken));
    const withinGrace =
      reuseAtRaw !== null &&
      Date.now() - Number(reuseAtRaw) < this.reuseGraceSeconds() * 1000;
    return !withinGrace;
  }

  // 时间化轮换：token 未到轮换年龄时不轮换、保持同一 refresh cookie，
  // 从根上降低多标签页共享 cookie 的轮换竞态频率
  private async maybeRotate(
    refreshToken: string,
    userId: string,
    family: string,
    active: string,
    accessToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const createdAtRaw = await this.redis.get(this.activeAtKey(refreshToken));
    const createdAt = createdAtRaw ? Number(createdAtRaw) : 0;
    if (Date.now() - createdAt < this.rotationMs()) {
      return { accessToken, refreshToken };
    }
    return this.rotate(refreshToken, userId, family, active, accessToken);
  }

  // 轮换：删除旧 token → 记录复用标记（含轮换时间）→ 同家族签发新 token
  private async rotate(
    refreshToken: string,
    userId: string,
    family: string,
    active: string,
    accessToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const ttl = this.refreshTtl();
    await this.execMulti(
      this.redis.raw
        .multi()
        .del(this.refreshKey(refreshToken), this.activeAtKey(refreshToken))
        .srem(this.familyKey(family), refreshToken)
        .set(this.reuseKey(refreshToken), active, 'EX', ttl)
        .set(this.reuseAtKey(refreshToken), String(Date.now()), 'EX', ttl),
    );
    const newRefreshToken = await this.issueRefreshToken(userId, family);
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(jti: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const active = await this.redis.get(this.refreshKey(refreshToken));
      const parsed = this.parseActive(active);
      if (parsed) {
        await this.revokeFamily(parsed.family);
      } else {
        // active 缺失：可能是已轮换 token，其 family 在 reuse key 中，
        // 据此撤销整个家族（含有效后继），避免登出后会话仍可刷新
        const reused = await this.redis.get(this.reuseKey(refreshToken));
        const reusedParsed = this.parseActive(reused);
        if (reusedParsed) {
          await this.revokeFamily(reusedParsed.family);
        } else {
          await this.redis.del(
            this.refreshKey(refreshToken),
            this.activeAtKey(refreshToken),
            this.reuseKey(refreshToken),
            this.reuseAtKey(refreshToken),
          );
        }
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
