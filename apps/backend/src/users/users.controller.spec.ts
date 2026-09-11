import { Test } from '@nestjs/testing';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController', () => {
  let controller: UsersController;
  const service = {
    list: vi.fn(),
    getDetail: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  };

  const user: CurrentUserPayload = {
    userId: 'admin1',
    jti: 'j',
    role: 'admin',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();
    controller = moduleRef.get(UsersController);
  });

  it('list 转发 query', async () => {
    const query = { page: 2, pageSize: 10, status: 0, keyword: 'a' };
    await controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('get 转发 id', async () => {
    await controller.get('u1');
    expect(service.getDetail).toHaveBeenCalledWith('u1');
  });

  it('updateStatus 转发操作者身份、目标 id 与 status', async () => {
    await controller.updateStatus(user, 'u1', { status: 0 });
    expect(service.updateStatus).toHaveBeenCalledWith(
      { userId: 'admin1', role: 'admin' },
      'u1',
      0,
    );
  });

  it('remove 转发操作者身份与目标 id', async () => {
    await controller.remove(user, 'u1');
    expect(service.remove).toHaveBeenCalledWith(
      { userId: 'admin1', role: 'admin' },
      'u1',
    );
  });
});
