import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DenylistService } from '../redis/denylist.service.js';
import { UserAccessService } from '../users/user-access.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: DenylistService,
    private readonly userAccess: UserAccessService,
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
  }): Promise<{ userId: string; jti: string; role: string }> {
    if (await this.denylist.isDenied(payload.jti)) {
      throw new UnauthorizedException('令牌已失效');
    }
    // verify 用户仍存在且可用：注销/禁用后签发的 token 立即失效。
    // 可用状态与角色经 UserAccessService 走同一次 Redis 短 TTL 缓存，避免每个已认证
    // 请求都打一次 users 表；Redis 不可用时回退查库，保证认证不被缓存故障阻断。
    const access = await this.userAccess.getAccess(payload.sub);
    if (access.status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }
    return { userId: payload.sub, jti: payload.jti, role: access.role };
  }
}
