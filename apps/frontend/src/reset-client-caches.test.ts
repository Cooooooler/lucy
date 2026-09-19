import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useKnowledgeViewState } from './hooks/use-knowledge-view-state';
import { queryClient } from './queryClient';
import { resetClientCaches } from './reset-client-caches';

describe('resetClientCaches', () => {
  afterEach(() => {
    // 清理写进单例 QueryClient 的探针数据，避免污染同文件其它用例
    queryClient.removeQueries({ queryKey: ['probe'] });
  });

  it('清空 QueryClient 缓存（不再命中旧的列表数据）', () => {
    queryClient.setQueryData(['probe'], 1);
    expect(queryClient.getQueryData(['probe'])).toBe(1);

    resetClientCaches();

    expect(queryClient.getQueryData(['probe'])).toBeUndefined();
  });

  it('复位会话内视图状态：筛选清空、首可见项索引归零', () => {
    const first = renderHook(() => useKnowledgeViewState());
    act(() => {
      first.result.current.saveFilter({ name: '甲' });
      first.result.current.saveFirstVisibleIndex(9);
    });
    first.unmount();

    resetClientCaches();

    // 重新挂载才读得到冻结的初值：模拟下一个账号进入页面
    const second = renderHook(() => useKnowledgeViewState());
    expect(second.result.current.initialFilter).toEqual({});
    expect(second.result.current.initialRestoreIndex).toBe(0);
  });
});
