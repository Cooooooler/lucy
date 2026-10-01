import { render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it } from 'vitest';
import { Route as ModelProviderRoute } from './model-provider';

// 用 Route 的真实 options.component 渲染（路由默认配置即直接渲染组件）
function renderModelProvider() {
  // Route.options.component 在类型上可能 undefined（TanStack Router 的宽泛类型）
  const C = (ModelProviderRoute as unknown as { options: { component: FC } })
    .options.component;
  return render(<C />);
}

describe('routes/_layout/integration/model-provider', () => {
  it('渲染引导标题与说明', () => {
    renderModelProvider();
    expect(
      screen.getByRole('heading', { name: '模型供应商' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '选择一个为应用提供能力的语言模型。在工作区中开始构建前，至少需要配置一个。',
      ),
    ).toBeInTheDocument();
  });
});
