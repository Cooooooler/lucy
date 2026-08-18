import { DenylistService } from '../redis/denylist.service.js';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';

describe('AuthModule', () => {
  it('声明 DenylistService 为 provider（狗食化后改由此模块提供）', () => {
    const providers = (Reflect.getMetadata('providers', AuthModule) ??
      []) as unknown[];
    expect(providers).toContain(DenylistService);
    expect(providers).toContain(AuthService);
  });
});
