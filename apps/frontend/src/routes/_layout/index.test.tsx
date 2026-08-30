import { render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it } from 'vitest';
import { Route as HomeRoute } from './index';

function renderHome() {
  const C = HomeRoute.options.component as FC;
  return render(<C />);
}

describe('routes/_layout/index', () => {
  it('渲染三个 StatisticCard 标题', () => {
    renderHome();
    expect(screen.getByText('用户数')).toBeInTheDocument();
    expect(screen.getByText('订单量')).toBeInTheDocument();
    expect(screen.getByText('销售额')).toBeInTheDocument();
  });
});
