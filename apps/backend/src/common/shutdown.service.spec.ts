import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppLogger } from './app-logger.service.js';
import { ShutdownService } from './shutdown.service.js';

describe('ShutdownService', () => {
  const loggerMock = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = loggerMock as unknown as AppLogger;

  let service: ShutdownService;

  const buildService = async (
    env: Record<string, unknown> = {},
  ): Promise<ShutdownService> => {
    const module = await Test.createTestingModule({
      providers: [
        ShutdownService,
        {
          provide: ConfigService,
          useValue: new ConfigService({ SHUTDOWN_GRACE_MS: 15000, ...env }),
        },
        { provide: AppLogger, useValue: logger },
      ],
    }).compile();
    return module.get(ShutdownService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service = await buildService();
  });

  it('初始状态未停机', () => {
    expect(service.isShutdown()).toBe(false);
  });

  it('调用 startShutdown 后返回 true', () => {
    service.startShutdown();
    expect(service.isShutdown()).toBe(true);
  });

  it('beforeApplicationShutdown：置停机位并武装兜底强退，超宽限期后强制退出', () => {
    vi.useFakeTimers();
    try {
      const exit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);

      service.beforeApplicationShutdown();

      expect(service.isShutdown()).toBe(true);
      expect(exit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(15000);

      expect(loggerMock.error).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onApplicationShutdown：撤销兜底定时器，成功停机不再被强退', () => {
    vi.useFakeTimers();
    try {
      const exit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);

      service.beforeApplicationShutdown();
      // 停机生命周期走完（服务器已 dispose）
      service.onApplicationShutdown();

      expect(service.isShutdown()).toBe(true);
      vi.advanceTimersByTime(60000);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('宽限期取自 SHUTDOWN_GRACE_MS', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      service = await buildService({ SHUTDOWN_GRACE_MS: 2000 });

      service.beforeApplicationShutdown();
      vi.advanceTimersByTime(1999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
