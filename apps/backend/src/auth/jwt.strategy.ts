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
    // verify 用户仍存在且可用：注销/禁用后签发的 token 立即失效
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }
    return { userId: payload.sub, jti: payload.jti };
  }
}
