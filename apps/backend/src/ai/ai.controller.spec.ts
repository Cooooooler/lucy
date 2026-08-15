import { AiStreamEvent } from '@lucy/shared';
import { Observable } from 'rxjs';
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

  function mockRes() {
    const headers: Record<string, string> = {};
    const writes: string[] = [];
    let closeHandler: () => void = () => {};
    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
      end: vi.fn(),
      destroyed: false,
      writableEnded: false,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') closeHandler = cb;
      }),
    };
    return { res, headers, writes, getCloseHandler: () => closeHandler };
  }

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

  it('sendMessage 以 SSE 帧写出事件并以 [DONE] 收尾', () => {
    const { res, headers, writes } = mockRes();
    const events: AiStreamEvent[] = [
      {
        type: 'delta',
        requestId: 'r1',
        role: 'ai',
        data: { content: '你' },
      },
      {
        type: 'done',
        requestId: 'r1',
        role: 'ai',
        data: { finish_reason: 'stop' },
      },
    ];
    aiService.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>((sub) => {
        events.forEach((e) => sub.next(e));
        sub.complete();
      }),
    );

    controller.send(res as never, user, 'c1', { content: 'hi' });

    expect(aiService.sendMessage).toHaveBeenCalledWith('1', 'c1', {
      content: 'hi',
    });
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(writes).toEqual(
      events
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .concat('data: [DONE]\n\n'),
    );
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('sendMessage 客户端断开时取消订阅', () => {
    const { res, getCloseHandler } = mockRes();
    const unsubscribe = vi.fn();
    aiService.sendMessage.mockReturnValue({
      subscribe: () => ({ unsubscribe }),
    });

    controller.send(res as never, user, 'c1', { content: 'hi' });

    getCloseHandler()();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
