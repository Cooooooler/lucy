import { AiController } from '@/ai/ai.controller.js';
import { AiStreamEvent } from '@lucy/shared';
import { Observable } from 'rxjs';

describe('AiController', () => {
  const aiService = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  };
  // SSE 端点已改走 ChatStreamService
  const chatStream = { sendMessage: vi.fn() };
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  };
  let controller: AiController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AiController(
      aiService as never,
      chatStream as never,
      logger as never,
    );
  });

  const user = { userId: '1', jti: 'j', role: 'user' };

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

  it('create 透传 userId', async () => {
    await controller.create(user);
    expect(aiService.create).toHaveBeenCalledWith('1');
  });

  it('list 透传游标与条数', async () => {
    await controller.list(user, { cursor: 'abc', limit: 10 });
    expect(aiService.list).toHaveBeenCalledWith('1', 'abc', 10);
  });

  it('list 缺省分页参数原样透传（默认值与上界由 KeysetPaginator 归一化，避免两处各有一份）', async () => {
    await controller.list(user, {});
    expect(aiService.list).toHaveBeenCalledWith('1', undefined, undefined);
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
    chatStream.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>((sub) => {
        events.forEach((e) => sub.next(e));
        sub.complete();
      }),
    );

    controller.send(res as never, user, 'c1', { content: 'hi' });

    expect(chatStream.sendMessage).toHaveBeenCalledWith('1', 'c1', {
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
    chatStream.sendMessage.mockReturnValue({
      subscribe: () => ({ unsubscribe }),
    });

    controller.send(res as never, user, 'c1', { content: 'hi' });

    getCloseHandler()();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sendMessage 流意外出错时记录日志并关闭响应，不向进程抛出（否则会触发 uncaughtException 退出）', () => {
    const { res } = mockRes();
    // 生产者的同步抛错由 RxJS 转成 error 通知；缺省 error 回调时它会被 rethrow 到宿主环境
    chatStream.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>(() => {
        throw new Error('write boom');
      }),
    );

    expect(() =>
      controller.send(res as never, user, 'c1', { content: 'hi' }),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('sendMessage 以非 Error 值出错时按 String 记日志且不带栈', () => {
    const { res } = mockRes();
    // RxJS 的 error 通知不要求 Error：SDK/中间层可能 reject 字符串或普通对象
    chatStream.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>((sub) => sub.error('boom-string')),
    );

    controller.send(res as never, user, 'c1', { content: 'hi' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('boom-string'),
      undefined,
      AiController.name,
    );
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('sendMessage 出错且响应已结束（writableEnded）时不再重复 end', () => {
    const { res } = mockRes();
    res.writableEnded = true;
    chatStream.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>((sub) => sub.error(new Error('late'))),
    );

    controller.send(res as never, user, 'c1', { content: 'hi' });

    expect(res.end).not.toHaveBeenCalled();
  });

  it('sendMessage 出错且连接已销毁时不再尝试 end', () => {
    const { res } = mockRes();
    res.destroyed = true;
    chatStream.sendMessage.mockReturnValue(
      new Observable<AiStreamEvent>((sub) => sub.error(new Error('gone'))),
    );

    controller.send(res as never, user, 'c1', { content: 'hi' });

    expect(res.end).not.toHaveBeenCalled();
  });

  it('sendMessage 写帧同步抛错时就地兜住：记日志、退订并关闭响应，不向进程抛出', () => {
    const { res } = mockRes();
    const unsubscribe = vi.fn();
    // 客户端断开后 res.write 会同步抛错；这个异常发生在 next 回调里，
    // RxJS 不会交给 error 回调，而是异步重抛到宿主环境（uncaughtException）
    res.write.mockImplementation(() => {
      throw new Error('socket gone');
    });
    chatStream.sendMessage.mockReturnValue({
      subscribe: (observer: { next: (event: AiStreamEvent) => void }) => {
        observer.next({
          type: 'delta',
          requestId: 'r1',
          role: 'ai',
          data: { content: '你' },
        });
        return { unsubscribe };
      },
    });

    expect(() =>
      controller.send(res as never, user, 'c1', { content: 'hi' }),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('socket gone'),
      expect.any(String),
      AiController.name,
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('sendMessage 收尾帧写失败时同样兜住，且只 end 一次', () => {
    const { res } = mockRes();
    const unsubscribe = vi.fn();
    res.write.mockImplementation(() => {
      throw new Error('closed pipe');
    });
    chatStream.sendMessage.mockReturnValue({
      subscribe: (observer: { complete: () => void }) => {
        observer.complete();
        return { unsubscribe };
      },
    });

    expect(() =>
      controller.send(res as never, user, 'c1', { content: 'hi' }),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
