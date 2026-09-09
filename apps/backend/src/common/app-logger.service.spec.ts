import { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from './app-logger.service.js';

function makeLogger(userId: string | null, active = true): AppLogger {
  const cls = {
    isActive: () => active,
    get: vi.fn().mockReturnValue(userId),
  } as unknown as ClsService;
  return new AppLogger(cls);
}

describe('AppLogger', () => {
  it('log 自动补齐 CLS 中的 userId', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      makeLogger('u1').log('kb create', 'KnowledgeService');
      expect(spy).toHaveBeenCalledWith('kb create user=u1 [KnowledgeService]');
    } finally {
      spy.mockRestore();
    }
  });

  it('CLS 未激活时退化为 user=-', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      makeLogger(null, false).log('hello');
      expect(spy).toHaveBeenCalledWith('hello user=-');
    } finally {
      spy.mockRestore();
    }
  });

  it('warn 走 console.warn 并带 userId', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      makeLogger('u2').warn('login failed');
      expect(spy).toHaveBeenCalledWith('login failed user=u2');
    } finally {
      spy.mockRestore();
    }
  });
});
