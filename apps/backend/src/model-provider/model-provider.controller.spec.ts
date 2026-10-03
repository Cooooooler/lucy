import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { ModelConnectionService } from './model-connection.service.js';
import { ModelProviderController } from './model-provider.controller.js';
import { ModelProviderService } from './model-provider.service.js';

describe('ModelProviderController', () => {
  let controller: ModelProviderController;
  const service = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const connection = { test: vi.fn() };

  const user: CurrentUserPayload = { userId: 'u1', jti: 'j', role: 'user' };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ModelProviderController],
      providers: [
        { provide: ModelProviderService, useValue: service },
        { provide: ModelConnectionService, useValue: connection },
      ],
    }).compile();
    controller = moduleRef.get(ModelProviderController);
  });

  it('create 转发 userId 与 dto', async () => {
    const dto = {
      name: 'm',
      type: 'llm',
      vendor: 'openai',
      baseUrl: 'https://x/v1',
      contextLength: 1,
      apiKey: 'k',
    } as never;
    await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
  });

  it('list 转发 userId 与 query', async () => {
    const query = { cursor: 'abc', limit: 10 };
    await controller.list(user, query);
    expect(service.list).toHaveBeenCalledWith('u1', query);
  });

  it('get 转发 userId 与 id', async () => {
    await controller.get(user, 'm1');
    expect(service.get).toHaveBeenCalledWith('u1', 'm1');
  });

  it('update 转发 userId、id、dto', async () => {
    const dto = { name: 'y' };
    await controller.update(user, 'm1', dto);
    expect(service.update).toHaveBeenCalledWith('u1', 'm1', dto);
  });

  it('remove 转发 userId 与 id', async () => {
    await controller.remove(user, 'm1');
    expect(service.remove).toHaveBeenCalledWith('u1', 'm1');
  });

  it('testConnection 转发到 connection 服务', async () => {
    await controller.testConnection(user, 'm1');
    expect(connection.test).toHaveBeenCalledWith('u1', 'm1');
  });
});
