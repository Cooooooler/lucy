import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearViewCaches } from '../src/clear-view-caches';
import { PageStateCache, usePageState } from '../src/page-state-cache';
import { readScrollOffset, writeScrollOffset } from '../src/scroll-memory';

const Probe = () => {
  const [value, setValue] = usePageState('keyword', '');
  return (
    <div>
      <span data-testid="value">{value}</span>
      <button onClick={() => setValue('产品')}>set</button>
    </div>
  );
};

describe('clearViewCaches', () => {
  beforeEach(() => {
    clearViewCaches();
  });

  it('同时清空页面状态与滚动位置（登出场景）', async () => {
    render(
      <PageStateCache cacheKey="page">
        <Probe />
      </PageStateCache>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'set' }));
    writeScrollOffset('page', 480);
    expect(screen.getByTestId('value').textContent).toBe('产品');

    act(() => clearViewCaches());

    expect(screen.getByTestId('value').textContent).toBe('');
    expect(readScrollOffset('page')).toBe(0);
  });
});
