import { createFileRoute } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Route as IntegrationRoute } from './integration';

// Outlet 需要 Router 上下文；本测试只关心「布局路由是否挂载 Outlet」
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Outlet: () => <div data-testid="integration-outlet" />,
}));

describe('routes/_layout/integration', () => {
  it('是布局路由：渲染 Outlet 而非内容', () => {
    // Route.options.component 在类型上可能 undefined（TanStack Router 的宽泛类型）
    const C = (IntegrationRoute as unknown as { options: { component: FC } })
      .options.component;
    render(<C />);
    expect(screen.getByTestId('integration-outlet')).toBeInTheDocument();
  });

  it('导出 createFileRoute 注册的路由', () => {
    expect(
      typeof (IntegrationRoute as unknown as { options: unknown }).options,
    ).toBe('object');
    void createFileRoute;
  });
});
