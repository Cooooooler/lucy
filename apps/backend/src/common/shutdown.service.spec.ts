import { Test } from '@nestjs/testing';
import { ShutdownService } from './shutdown.service.js';

describe('ShutdownService', () => {
  let service: ShutdownService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ShutdownService],
    }).compile();
    service = module.get(ShutdownService);
  });

  it('初始状态未停机', () => {
    expect(service.isShutdown()).toBe(false);
  });

  it('调用 startShutdown 后返回 true', () => {
    service.startShutdown();
    expect(service.isShutdown()).toBe(true);
  });

  it('onApplicationShutdown 触发停机标记', () => {
    service.onApplicationShutdown();
    expect(service.isShutdown()).toBe(true);
  });
});
