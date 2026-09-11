import { Test } from '@nestjs/testing';
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

  it('updateStatus 转发 id 与 status', async () => {
    await controller.updateStatus('u1', { status: 0 });
    expect(service.updateStatus).toHaveBeenCalledWith('u1', 0);
  });

  it('remove 转发 id', async () => {
    await controller.remove('u1');
    expect(service.remove).toHaveBeenCalledWith('u1');
  });
});
