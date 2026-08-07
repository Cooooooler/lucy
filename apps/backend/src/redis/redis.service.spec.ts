import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  let service: RedisService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: new Redis({
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: Number(process.env.REDIS_PORT ?? 6379),
          }),
        },
        RedisService,
      ],
    }).compile();
    service = module.get(RedisService);
  });

  afterAll(async () => {
    const client = (service as unknown as { client: Redis }).client;
    await client.del('spec:key', 'spec:key2');
    client.disconnect();
  });

  it('set/get 往返', async () => {
    await service.set('spec:key', 'v', 60);
    await expect(service.get('spec:key')).resolves.toBe('v');
  });

  it('del 后 exists 为 false', async () => {
    await service.set('spec:key2', 'v');
    await service.del('spec:key2');
    await expect(service.exists('spec:key2')).resolves.toBe(false);
  });
});
