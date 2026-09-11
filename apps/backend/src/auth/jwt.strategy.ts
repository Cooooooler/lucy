import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DenylistService } from '../redis/denylist.service.js';
import { UserStatusService } from '../users/user-status.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: DenylistService,
    private readonly userStatus: UserStatusService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub: string;
    jti: string;
  }): Promise<{ userId: string; jti: string }> {
    if (await this.denylist.isDenied(payload.jti)) {
      throw new UnauthorizedException('令牌已失效');
    }
    // verify 用户仍存在且可用：注销/禁用后签发的 token 立即失效。
    // 可用性经 UserStatusService 走 Redis 短 TTL 缓存，避免每个已认证请求都打一次
    // users 表；Redis 不可用时回退查库，保证认证不被缓存故障阻断。
    if (!(await this.userStatus.isActive(payload.sub))) {
      throw new UnauthorizedException('账号不可用');
    }
    return { userId: payload.sub, jti: payload.jti };
  }
}
