import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { DenylistService } from './denylist.service';
import { REDIS_CLIENT } from './redis.constants';

describe('DenylistService', () => {
  let service: DenylistService;
  let client: Redis;

  beforeAll(async () => {
    client = new Redis({ host: '127.0.0.1', port: 6379 });
    const module = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: client },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_EXPIRES_IN: '15m' }),
        },
        DenylistService,
      ],
    }).compile();
    service = module.get(DenylistService);
    await service.ensureInitialized();
  });

  afterAll(async () => {
    await client.del(
      'auth:denylist:cur',
      'auth:denylist:prev',
      'auth:denylist:gen-ts',
      'auth:denylist:lock',
      'auth:denied:spec-jti-1',
      'auth:denied:spec-jti-2',
      'auth:denied:spec-jti-selfinit',
    );
    client.disconnect();
  });

  it('add 后 isDenied 为 true', async () => {
    await service.add('spec-jti-1');
    await expect(service.isDenied('spec-jti-1')).resolves.toBe(true);
  });

  it('未加入的 jti isDenied 为 false', async () => {
    await expect(service.isDenied('spec-jti-2')).resolves.toBe(false);
  });

  it('未初始化时 add 自动引导（自创建 cur）', async () => {
    // 删除现有布隆键模拟全新状态
    await client.del(
      'auth:denylist:cur',
      'auth:denylist:prev',
      'auth:denylist:gen-ts',
      'auth:denylist:lock',
    );
    await service.add('spec-jti-selfinit');
    await expect(service.isDenied('spec-jti-selfinit')).resolves.toBe(true);
  });
});
