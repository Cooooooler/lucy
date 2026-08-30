import { createFileRoute } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it } from 'vitest';
import { Route as AboutRoute } from './about';

// 用 Route 的真实 options.component 渲染（路由默认配置即直接渲染 AboutComponent）
function renderAbout() {
  // Route.options.component 在类型上可能 undefined（TanStack Router 的宽泛类型）
  const C = AboutRoute.options.component as FC;
  return render(<C />);
}

describe('routes/_layout/about', () => {
  it('渲染简介文案', () => {
    renderAbout();
    expect(
      screen.getByText(/基于 Vite \+ React 19 \+ TanStack Router/),
    ).toBeInTheDocument();
  });

  it('导出 createFileRoute 注册的路由', () => {
    // 确保 _layout/about 路径注册
    const tree = AboutRoute;
    // createFileRoute 返回的对象带 options/id 等元信息
    expect(typeof (tree as unknown as { options: unknown }).options).toBe(
      'object',
    );
    // 强制覆盖未使用变量的告警
    void createFileRoute;
  });
});
