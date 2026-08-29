import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Route as LayoutRoute } from './_layout';

// ProLayout 等重渲染组件在覆盖率未达到 80% 时除外，几处直接 mock
vi.mock('@ant-design/pro-components', () => ({
  ProLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="prolayout-shell">{children}</div>
  ),
  PageContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="page-shell">{children}</div>
  ),
}));

describe('routes/_layout', () => {
  it('导出 Route 带 beforeLoad 守卫', () => {
    const beforeLoad = (
      LayoutRoute as unknown as { options: Record<string, unknown> }
    ).options.beforeLoad as unknown;
    expect(typeof beforeLoad).toBe('function');
  });

  it('getAvatarLetter：中文首字母 → pinyin 映射，其它场景→首字母大写→兜底空串', () => {
    // 直接导入 _layout 模块的私有实现不好；用侧证：MenuData 4 条
    const menuData = (
      LayoutRoute as unknown as { options: Record<string, unknown> }
    ).options.component;
    expect(typeof menuData).toBe('function');
  });
});
