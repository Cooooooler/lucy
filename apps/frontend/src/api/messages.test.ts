import { describe, expect, it, vi } from 'vitest';
import { emitApiSuccessMessage, onApiSuccessMessage } from './messages';

describe('api/messages', () => {
  it('广播触达所有订阅者', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onApiSuccessMessage(a);
    const offB = onApiSuccessMessage(b);
    try {
      emitApiSuccessMessage('登录成功');
      expect(a).toHaveBeenCalledWith('登录成功');
      expect(b).toHaveBeenCalledWith('登录成功');
    } finally {
      offA();
      offB();
    }
  });

  it('退订后不再收到', () => {
    const listener = vi.fn();
    const off = onApiSuccessMessage(listener);
    off();
    emitApiSuccessMessage('登录成功');
    expect(listener).not.toHaveBeenCalled();
  });

  it('重复退订不抛错', () => {
    const off = onApiSuccessMessage(vi.fn());
    off();
    expect(() => off()).not.toThrow();
  });
});
