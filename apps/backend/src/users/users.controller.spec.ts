import { Test } from '@nestjs/testing';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { UserRole } from '../common/roles.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * 这里钉的不是「参数被转交」，而是控制器把 `CurrentUserPayload` 收窄成
 * `ActorContext`（`{ userId, role }`）这一步转换。
 *
 * e2e 只覆盖了 `GET /users` 与 `PATCH /users/:id/role`；其余三个端点若漏传 `role`
 * （或整对象透传），service 的层级校验会 fail-closed 成 403 / 空列表，且现有
 * service 单测（直接构造 actor）与 e2e 都不会失败——所以这条映射需要单测守着。
 *
 * audit-allow: delegation-only —— 断言的是身份收窄（转换），不是原样透传。
 */
describe('UsersController 身份映射', () => {
  const service = {
    getDetail: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  };
  let controller: UsersController;

  const user: CurrentUserPayload = {
    userId: 'admin1',
    jti: 'j',
    role: UserRole.Admin,
  };
  const actor = { userId: 'admin1', role: UserRole.Admin };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();
    controller = moduleRef.get(UsersController);
  });

  it('get 把身份收窄成 { userId, role }', async () => {
    await controller.get(user, 'u1');
    expect(service.getDetail).toHaveBeenCalledWith(actor, 'u1');
  });

  it('updateStatus 把身份收窄成 { userId, role }', async () => {
    await controller.updateStatus(user, 'u1', { status: 0 });
    expect(service.updateStatus).toHaveBeenCalledWith(actor, 'u1', 0);
  });

  it('remove 把身份收窄成 { userId, role }', async () => {
    await controller.remove(user, 'u1');
    expect(service.remove).toHaveBeenCalledWith(actor, 'u1');
  });
});
