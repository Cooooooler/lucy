import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DenylistService } from '../redis/denylist.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: DenylistService,
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
    return { userId: payload.sub, jti: payload.jti };
  }
}
