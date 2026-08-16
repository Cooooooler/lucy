import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT, REDIS_SERIALIZER } from './redis.constants.js';
import { RedisException } from './redis.exception.js';
import { RedisService } from './redis.service.js';
import { defaultJsonSerializer, type RedisSerializer } from './serializer.js';

function mockClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
  };
}

async function buildService(
  client: ReturnType<typeof mockClient>,
  serializer: RedisSerializer = defaultJsonSerializer,
) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: REDIS_CLIENT, useValue: client },
      { provide: REDIS_SERIALIZER, useValue: serializer },
      RedisService,
    ],
  }).compile();
  return module.get(RedisService);
}

describe('RedisService', () => {
  it('get 透传', async () => {
    const client = mockClient();
    client.get.mockResolvedValue('v');
    const svc = await buildService(client);
    await expect(svc.get('k')).resolves.toBe('v');
    expect(client.get).toHaveBeenCalledWith('k');
  });

  it('set 带 TTL 使用 EX', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.set('k', 'v', 60);
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
  });

  it('set 无 TTL 直接 set', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.set('k', 'v');
    expect(client.set).toHaveBeenCalledWith('k', 'v');
  });

  it('del 返回数量', async () => {
    const client = mockClient();
    client.del.mockResolvedValue(2);
    const svc = await buildService(client);
    await expect(svc.del('a', 'b')).resolves.toBe(2);
  });

  it('exists 归一为布尔', async () => {
    const client = mockClient();
    client.exists.mockResolvedValue(1);
    const svc = await buildService(client);
    await expect(svc.exists('k')).resolves.toBe(true);
  });

  it('ioredis 错误被包装为 RedisException', async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = await buildService(client);
    await expect(svc.get('k')).rejects.toBeInstanceOf(RedisException);
  });

  it('raw 暴露底层 client', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    expect(svc.raw).toBe(client);
  });

  it('setJson 走 serializer 后写入', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.setJson('k', { a: 1 }, 60);
    expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 60);
  });

  it('setJson 无 TTL 直接写入', async () => {
    const client = mockClient();
    const svc = await buildService(client);
    await svc.setJson('k', { a: 1 });
    expect(client.set).toHaveBeenCalledWith('k', '{"a":1}');
  });

  it('getJson 反序列化返回对象', async () => {
    const client = mockClient();
    client.get.mockResolvedValue('{"a":1}');
    const svc = await buildService(client);
    await expect(svc.getJson<{ a: number }>('k')).resolves.toEqual({ a: 1 });
  });

  it('getJson 无 key 返回 null', async () => {
    const client = mockClient();
    client.get.mockResolvedValue(null);
    const svc = await buildService(client);
    await expect(svc.getJson('k')).resolves.toBeNull();
  });

  it('getJson 自动还原 Date', async () => {
    const client = mockClient();
    client.get.mockResolvedValue('{"at":"2026-08-16T10:00:00.000Z"}');
    const svc = await buildService(client);
    const v = await svc.getJson<{ at: Date }>('k');
    expect(v?.at).toBeInstanceOf(Date);
  });

  it('自定义序列化器被使用', async () => {
    const client = mockClient();
    const custom: RedisSerializer = {
      serialize: () => 'C',
      deserialize: () => 'D',
    };
    const svc = await buildService(client, custom);
    await svc.setJson('k', 'any');
    expect(client.set).toHaveBeenCalledWith('k', 'C');
    client.get.mockResolvedValue('ignored');
    await expect(svc.getJson('k')).resolves.toBe('D');
  });
});
