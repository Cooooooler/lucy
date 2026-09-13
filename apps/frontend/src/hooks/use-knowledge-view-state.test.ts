import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKnowledgeViewState } from './use-knowledge-view-state';

describe('useKnowledgeViewState', () => {
  it('写入后再次挂载能读回筛选与首可见项索引', () => {
    const first = renderHook(() => useKnowledgeViewState());
    act(() => {
      first.result.current.saveFilter({ name: '产品', visibility: 'private' });
      first.result.current.saveFirstVisibleIndex(42);
    });
    first.unmount();

    const second = renderHook(() => useKnowledgeViewState());
    expect(second.result.current.initialFilter).toEqual({
      name: '产品',
      visibility: 'private',
    });
    expect(second.result.current.initialRestoreIndex).toBe(42);
  });

  it('挂载期间写入不改变已冻结的待恢复索引（重渲染后仍是冻结值）', () => {
    const { result, rerender } = renderHook(() => useKnowledgeViewState());
    const frozen = result.current.initialRestoreIndex;

    act(() => {
      result.current.saveFirstVisibleIndex(frozen + 1);
    });
    // 强制一次重渲染：若实现是「每次渲染直接读 store」而非挂载时冻结，
    // 这里会读到刚写入的新值，断言即失败
    rerender();

    expect(result.current.initialRestoreIndex).toBe(frozen);
  });

  it('saveFilter 替换而非原地修改 store，已捕获的快照不被污染', () => {
    const first = renderHook(() => useKnowledgeViewState());
    act(() => {
      first.result.current.saveFilter({ name: '甲' });
    });
    first.unmount();

    const second = renderHook(() => useKnowledgeViewState());
    const snapshot = second.result.current.initialFilter;

    act(() => {
      second.result.current.saveFilter({ name: '乙' });
    });

    // 若 saveFilter 原地 mutate state.filter，snapshot 会跟着变成「乙」
    expect(snapshot.name).toBe('甲');
  });
});
