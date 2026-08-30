import { describe, expect, it } from 'vitest';
import { Route as AuthRoute } from './_auth';

describe('routes/_auth', () => {
  it('导出的 Route 包含 beforeLoad 守卫', () => {
    const beforeLoad = (
      AuthRoute as unknown as { options: Record<string, unknown> }
    ).options.beforeLoad as unknown;
    expect(typeof beforeLoad).toBe('function');
  });
});
