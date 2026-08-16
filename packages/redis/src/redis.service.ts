import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { toRedisException } from './redis.exception.js';

/**
 * 轻量 Redis 访问门面。
 * 通过 DI 注入底层 ioredis 客户端；所有命令异常统一包装为 {@link RedisException}。
 * 底层 client 经 {@link RedisService.raw} 暴露，供高级用法（BF、eval、pipeline）直接操作。
 */
@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** 底层 ioredis 实例（逃生舱，供 BF、eval、pipeline 等高级用法，不经过异常包装） */
  get raw(): Redis {
    return this.client;
  }

  /** 取原始字符串值；key 不存在返回 null */
  async get(key: string): Promise<string | null> {
    return this.wrap(() => this.client.get(key));
  }

  /** 写入字符串；传 ttlSeconds 时附加 EX 过期时间 */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.wrap(async () => {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    });
  }

  /** 删除若干 key，返回实际删除的数量 */
  async del(...keys: string[]): Promise<number> {
    return this.wrap(() => this.client.del(...keys));
  }

  /** 判断 key 是否存在 */
  async exists(key: string): Promise<boolean> {
    return this.wrap(async () => (await this.client.exists(key)) === 1);
  }

  /** 执行命令并把 ioredis 错误统一包装为 RedisException */
  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toRedisException(error);
    }
  }
}
