import { DenylistModule } from '../redis/denylist.module.js';
import { DenylistService } from '../redis/denylist.service.js';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';

describe('AuthModule', () => {
  it('通过导入 DenylistModule 使用 DenylistService，而非直接声明为 provider', () => {
    const imports = (Reflect.getMetadata('imports', AuthModule) ??
      []) as unknown[];
    expect(imports).toContain(DenylistModule);
    const providers = (Reflect.getMetadata('providers', AuthModule) ??
      []) as unknown[];
    expect(providers).not.toContain(DenylistService);
    expect(providers).toContain(AuthService);
  });

  it('DenylistModule 提供并导出 DenylistService', () => {
    const providers = (Reflect.getMetadata('providers', DenylistModule) ??
      []) as unknown[];
    const exports = (Reflect.getMetadata('exports', DenylistModule) ??
      []) as unknown[];
    expect(providers).toContain(DenylistService);
    expect(exports).toContain(DenylistService);
  });
});
