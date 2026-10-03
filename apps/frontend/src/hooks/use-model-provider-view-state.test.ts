import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetModelProviderViewState,
  useModelProviderViewState,
} from './use-model-provider-view-state';

describe('useModelProviderViewState', () => {
  afterEach(() => {
    resetModelProviderViewState();
  });

  it('写入后再次挂载能读回筛选与首可见项索引', () => {
    const first = renderHook(() => useModelProviderViewState());
    act(() => {
      first.result.current.saveFilter({ name: 'gpt', type: 'llm' });
      first.result.current.saveFirstVisibleIndex(42);
    });
    first.unmount();

    const second = renderHook(() => useModelProviderViewState());
    expect(second.result.current.initialFilter).toEqual({
      name: 'gpt',
      type: 'llm',
    });
    expect(second.result.current.initialRestoreIndex).toBe(42);
  });

  it('挂载期间写入不改变已冻结的待恢复索引', () => {
    const { result, rerender } = renderHook(() => useModelProviderViewState());
    const frozen = result.current.initialRestoreIndex;

    act(() => {
      result.current.saveFirstVisibleIndex(frozen + 1);
    });
    rerender();

    expect(result.current.initialRestoreIndex).toBe(frozen);
  });

  it('resetModelProviderViewState 清空筛选与索引', () => {
    const first = renderHook(() => useModelProviderViewState());
    act(() => {
      first.result.current.saveFilter({ name: 'x' });
      first.result.current.saveFirstVisibleIndex(9);
    });
    first.unmount();

    resetModelProviderViewState();

    const second = renderHook(() => useModelProviderViewState());
    expect(second.result.current.initialFilter).toEqual({});
    expect(second.result.current.initialRestoreIndex).toBe(0);
  });
});
