import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPageStateCaches,
  PageStateCache,
  resetPageStateCache,
  usePageState,
} from './page-state-cache';

type ProbeProps = {
  field?: string;
  initial?: string;
};

/** 最小页面替身：一个被缓存的字段 + 两个写入入口（直接赋值 / 函数式更新） */
const Probe = ({ field = 'keyword', initial = '' }: ProbeProps) => {
  const [value, setValue] = usePageState(field, initial);
  return (
    <div>
      <span data-testid="value">{value}</span>
      <button onClick={() => setValue('产品')}>set</button>
      <button onClick={() => setValue((prev) => `${prev}!`)}>append</button>
    </div>
  );
};

function renderProbe(cacheKey = 'test-page', props: ProbeProps = {}) {
  return render(
    <PageStateCache cacheKey={cacheKey}>
      <Probe {...props} />
    </PageStateCache>,
  );
}

function valueText() {
  return screen.getByTestId('value').textContent;
}

describe('PageStateCache', () => {
  beforeEach(() => {
    clearPageStateCaches();
  });

  it('首次挂载使用初始值', () => {
    renderProbe('fresh', { initial: '默认' });
    expect(valueText()).toBe('默认');
  });

  it('卸载后重新挂载恢复上次写入的值（路由重新进入的核心场景）', async () => {
    const first = renderProbe('restore');
    await userEvent.click(screen.getByRole('button', { name: 'set' }));
    expect(valueText()).toBe('产品');
    first.unmount();

    renderProbe('restore');
    expect(valueText()).toBe('产品');
  });

  it('函数式更新基于缓存中的当前值', async () => {
    renderProbe('functional');
    await userEvent.click(screen.getByRole('button', { name: 'append' }));
    await userEvent.click(screen.getByRole('button', { name: 'append' }));
    expect(valueText()).toBe('!!');
  });

  it('不同 cacheKey 互不干扰', async () => {
    render(
      <>
        <PageStateCache cacheKey="page-a">
          <Probe />
        </PageStateCache>
        <PageStateCache cacheKey="page-b">
          <Probe />
        </PageStateCache>
      </>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'set' })[0]);

    const values = screen.getAllByTestId('value');
    expect(values[0].textContent).toBe('产品');
    expect(values[1].textContent).toBe('');
  });

  it('同一 cacheKey 下的多个组件共享同一字段', async () => {
    render(
      <PageStateCache cacheKey="shared">
        <Probe />
        <Probe initial="另一个初值" />
      </PageStateCache>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'set' })[0]);

    const values = screen.getAllByTestId('value');
    expect(values[0].textContent).toBe('产品');
    expect(values[1].textContent).toBe('产品');
  });

  it('同一 cacheKey 下的不同字段互不影响', async () => {
    render(
      <PageStateCache cacheKey="fields">
        <Probe field="name" />
        <Probe field="visibility" initial="all" />
      </PageStateCache>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'set' })[0]);

    const values = screen.getAllByTestId('value');
    expect(values[0].textContent).toBe('产品');
    expect(values[1].textContent).toBe('all');
  });

  it('clearPageStateCaches 复位全部页面（登出场景）', async () => {
    render(
      <>
        <PageStateCache cacheKey="page-a">
          <Probe />
        </PageStateCache>
        <PageStateCache cacheKey="page-b">
          <Probe initial="b" />
        </PageStateCache>
      </>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'set' })[0]);

    act(() => clearPageStateCaches());

    const values = screen.getAllByTestId('value');
    expect(values[0].textContent).toBe('');
    expect(values[1].textContent).toBe('b');
  });

  it('resetPageStateCache 只复位指定页面', async () => {
    render(
      <>
        <PageStateCache cacheKey="page-a">
          <Probe />
        </PageStateCache>
        <PageStateCache cacheKey="page-b">
          <Probe />
        </PageStateCache>
      </>,
    );
    const setButtons = screen.getAllByRole('button', { name: 'set' });
    await userEvent.click(setButtons[0]);
    await userEvent.click(setButtons[1]);

    act(() => resetPageStateCache('page-a'));

    const values = screen.getAllByTestId('value');
    expect(values[0].textContent).toBe('');
    expect(values[1].textContent).toBe('产品');
  });

  it('未包裹 <PageStateCache> 时抛出明确错误', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() => render(<Probe />)).toThrow(
        'usePageState 必须放在 <PageStateCache> 内使用',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
