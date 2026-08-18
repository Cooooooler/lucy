import { DenylistModule } from './denylist.module.js';
import { DenylistService } from './denylist.service.js';

describe('DenylistModule', () => {
  it('提供并导出 DenylistService', () => {
    const providers = (Reflect.getMetadata('providers', DenylistModule) ??
      []) as unknown[];
    const exports = (Reflect.getMetadata('exports', DenylistModule) ??
      []) as unknown[];
    expect(providers).toContain(DenylistService);
    expect(exports).toContain(DenylistService);
  });
});
