import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DenylistService } from '../redis/denylist.service.js';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: DenylistService,
    private readonly usersService: UsersService,
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
    // 代价是每个已认证请求多一次主键查询——这是为「立即失效」有意付出的成本，
    // 换取比 JWT 无状态语义更强的保证；若将来成为瓶颈，可改为主键查 status 或加短 TTL 缓存。
    const user = await this.usersService.findById(payload.sub);
    if (user?.status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }
    return { userId: payload.sub, jti: payload.jti };
  }
}
