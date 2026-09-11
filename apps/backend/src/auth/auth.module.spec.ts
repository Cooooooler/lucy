import { APP_GUARD } from '@nestjs/core';
import { DenylistModule } from '../redis/denylist.module.js';
import { DenylistService } from '../redis/denylist.service.js';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

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

  it('按顺序注册全局 JwtAuthGuard 与 RolesGuard（前者先填充 request.user）', () => {
    const providers = (Reflect.getMetadata('providers', AuthModule) ??
      []) as Array<{ provide?: unknown; useClass?: unknown }>;
    const guards = providers
      .filter(
        (p) =>
          p?.provide === APP_GUARD &&
          (p.useClass === JwtAuthGuard || p.useClass === RolesGuard),
      )
      .map((p) => p.useClass);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
  });
});
