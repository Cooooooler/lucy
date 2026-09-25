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

  it('单个订阅者抛错不影响其余订阅者，也不向外抛', () => {
    const bad = vi.fn(() => {
      throw new Error('toast boom');
    });
    const good = vi.fn();
    const offBad = onApiSuccessMessage(bad);
    const offGood = onApiSuccessMessage(good);
    try {
      expect(() => emitApiSuccessMessage('登录成功')).not.toThrow();
      expect(bad).toHaveBeenCalledWith('登录成功');
      expect(good).toHaveBeenCalledWith('登录成功');
    } finally {
      offBad();
      offGood();
    }
  });

  it('广播期间同步退订不跳过其余订阅者', () => {
    const order: string[] = [];
    let offFirst!: () => void;
    offFirst = onApiSuccessMessage(() => {
      order.push('first');
      offFirst();
    });
    const offSecond = onApiSuccessMessage(() => {
      order.push('second');
    });
    try {
      emitApiSuccessMessage('登录成功');
      expect(order).toEqual(['first', 'second']);
    } finally {
      offFirst();
      offSecond();
    }
  });
});
