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
    const config = new ConfigService({});
    expect(redisModuleOptions(config)).toEqual({
      type: 'standalone',
      host: '127.0.0.1',
      port: 6379,
    });
  });
});
