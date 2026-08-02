import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class DenylistService {
  private static readonly CUR = 'auth:denylist:cur';
  private static readonly PREV = 'auth:denylist:prev';
  private static readonly GEN_TS = 'auth:denylist:gen-ts';
  private static readonly LOCK = 'auth:denylist:lock';

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private get capacity(): number {
    return this.config.get<number>('BLOOM_CAPACITY', 1000000);
  }
  private get errorRate(): number {
    return this.config.get<number>('BLOOM_ERROR_RATE', 0.01);
  }
  private get rotationSeconds(): number {
    return this.config.get<number>('BLOOM_ROTATION_SECONDS', 900);
  }
  private get accessTtlSeconds(): number {
    const v = this.config.get<string>('JWT_EXPIRES_IN', '15m');
    const m = /^(\d+)([smhd])$/.exec(v);
    if (!m) return 900;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[
      m[2] as 's' | 'm' | 'h' | 'd'
    ];
    return Number(m[1]) * mult;
  }

  async ensureInitialized(): Promise<void> {
    const now = Date.now();
    const ts = await this.redis.get(DenylistService.GEN_TS);
    if (ts && now - Number(ts) < this.rotationSeconds * 1000) return;
    if (
      (await this.redis.set(DenylistService.LOCK, '1', 'EX', 5, 'NX')) !== 'OK'
    )
      return;
    try {
      const ts2 = await this.redis.get(DenylistService.GEN_TS);
      if (ts2 && now - Number(ts2) < this.rotationSeconds * 1000) return;
      await this.rotate();
    } finally {
      await this.redis.del(DenylistService.LOCK);
    }
  }

  async add(jti: string): Promise<void> {
    await this.redis.call('BF.ADD', DenylistService.CUR, jti);
    await this.redis.set(
      `auth:denied:${jti}`,
      '1',
      'EX',
      this.accessTtlSeconds,
    );
  }

  async isDenied(jti: string): Promise<boolean> {
    const inCur =
      (await this.redis.call('BF.EXISTS', DenylistService.CUR, jti)) === 1;
    const inPrev =
      (await this.redis.call('BF.EXISTS', DenylistService.PREV, jti)) === 1;
    if (!inCur && !inPrev) return false;
    return (await this.redis.exists(`auth:denied:${jti}`)) === 1;
  }

  private async rotate(): Promise<void> {
    await this.redis.del(DenylistService.PREV);
    if (await this.redis.exists(DenylistService.CUR)) {
      await this.redis.rename(DenylistService.CUR, DenylistService.PREV);
    }
    await this.redis.call(
      'BF.RESERVE',
      DenylistService.CUR,
      this.errorRate,
      this.capacity,
    );
    await this.redis.set(DenylistService.GEN_TS, String(Date.now()));
  }
}
