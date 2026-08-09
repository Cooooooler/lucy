import { AiController } from './ai.controller.js';

describe('AiController', () => {
  const aiService = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    sendMessage: vi.fn(),
  };
  let controller: AiController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AiController(aiService as never);
  });

  const user = { userId: '1', jti: 'j' };

  it('create 透传 userId 与 dto', async () => {
    await controller.create(user, { model: 'qwen' });
    expect(aiService.create).toHaveBeenCalledWith('1', { model: 'qwen' });
  });

  it('list 透传分页参数并转数字', async () => {
    await controller.list(user, { page: 2, pageSize: 10 });
    expect(aiService.list).toHaveBeenCalledWith('1', 2, 10);
  });

  it('list 缺省分页参数使用默认值', async () => {
    await controller.list(user, {});
    expect(aiService.list).toHaveBeenCalledWith('1', 1, 20);
  });

  it('get/rename/remove 透传', async () => {
    await controller.get(user, 'c1');
    await controller.rename(user, 'c1', { title: '新' });
    await controller.remove(user, 'c1');
    expect(aiService.get).toHaveBeenCalledWith('1', 'c1');
    expect(aiService.rename).toHaveBeenCalledWith('1', 'c1', '新');
    expect(aiService.remove).toHaveBeenCalledWith('1', 'c1');
  });

  it('sendMessage 返回 service 的流', () => {
    const obs = { subscribe: vi.fn() };
    aiService.sendMessage.mockReturnValue(obs);
    expect(controller.send(user, 'c1', { content: 'hi' })).toBe(obs);
    expect(aiService.sendMessage).toHaveBeenCalledWith('1', 'c1', {
      content: 'hi',
    });
  });
});
