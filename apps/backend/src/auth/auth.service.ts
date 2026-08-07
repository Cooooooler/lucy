import type { AuthTokens, LoginResult, User as SharedUser } from '@lucy/shared';
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

  private refreshKey(token: string): string {
    return `auth:refresh:${token}`;
  }

  private toSharedUser(user: User): SharedUser {
    const { id, username, email, nickname, status, createdAt, updatedAt } =
      user;
    return { id, username, email, nickname, status, createdAt, updatedAt };
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
  }): Promise<LoginResult> {
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
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<LoginResult> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(refreshToken),
      user.id,
      this.refreshTtl(),
    );
    return { accessToken, refreshToken, user: this.toSharedUser(user) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const userId = await this.redis.get(this.refreshKey(refreshToken));
    if (!userId) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '刷新令牌无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.usersService.findById(userId);
    if (user?.status !== 1) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '账号不可用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.redis.del(this.refreshKey(refreshToken));
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      jti: randomUUID(),
    });
    const newRefreshToken = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.refreshKey(newRefreshToken),
      user.id,
      this.refreshTtl(),
    );
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(jti: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.redis.del(this.refreshKey(refreshToken));
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
