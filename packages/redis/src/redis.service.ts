import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { toRedisException } from './redis.exception.js';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** 底层 ioredis 实例（逃生舱，供 BF.* / eval / pipeline 等高级用法，不经过异常包装） */
  get raw(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.wrap(() => this.client.get(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    });
  }

  async del(...keys: string[]): Promise<number> {
    return this.wrap(() => this.client.del(...keys));
  }

  async exists(key: string): Promise<boolean> {
    return this.wrap(async () => (await this.client.exists(key)) === 1);
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toRedisException(error);
    }
  }
}
