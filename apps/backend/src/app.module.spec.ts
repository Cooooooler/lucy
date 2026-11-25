import { ConfigService } from '@nestjs/config';
import { redisModuleOptions } from './app.module.js';

describe('redisModuleOptions', () => {
  it('从 ConfigService 读取 REDIS_HOST/PORT', () => {
    const config = new ConfigService({
      REDIS_HOST: 'r.example.com',
      REDIS_PORT: 7000,
    });
    expect(redisModuleOptions(config)).toEqual({
      type: 'standalone',
      host: 'r.example.com',
      port: 7000,
    });
  });

  it('缺省回退 127.0.0.1:6379', () => {
    // ConfigService 会回落到 process.env：外部 shell/CI 带着 REDIS_HOST/PORT 时，
    // 这条「缺省值」断言会变成在测外部环境。用例内临时清空，结束后原样恢复。
    const savedHost = process.env.REDIS_HOST;
    const savedPort = process.env.REDIS_PORT;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    try {
      const config = new ConfigService({});
      expect(redisModuleOptions(config)).toEqual({
        type: 'standalone',
        host: '127.0.0.1',
        port: 6379,
      });
    } finally {
      if (savedHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = savedHost;
      if (savedPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = savedPort;
    }
  });
});
