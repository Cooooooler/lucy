import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createListViewState,
  resetListViewState,
  useListViewState,
} from './create-list-view-state';

type Filter = { name?: string };

describe('createListViewState / useListViewState', () => {
  it('状态落在调用方持有的 store 上，而不是 hook 内部', () => {
    // 这是「React Compiler 安全」的前提，也是本节的重点：
    // hook 内的回调若捕获**工厂/组件局部**的可变绑定，Compiler 会把这个回调提升（outline）
    // 到模块作用域，运行时直接 `ReferenceError: state is not defined`（实测整页白屏，
    // 且 tsc 与 vitest 都发现不了——vitest 走 SWC、不跑 Compiler）。
    // store 由调用方在模块作用域持有、作为参数传入，才是响应式依赖，不会被提升。
    const store = createListViewState<Filter>();
    const { result } = renderHook(() => useListViewState(store));

    act(() => result.current.saveFilter({ name: '产品' }));
    act(() => result.current.saveFirstVisibleIndex(42));

    expect(store.filter).toEqual({ name: '产品' });
    expect(store.firstVisibleIndex).toBe(42);
  });

  it('挂载瞬间冻结 store 的当前值；后续写入不改动已冻结的值', () => {
    const store = createListViewState<Filter>();
    store.filter = { name: '甲' };
    store.firstVisibleIndex = 3;

    const { result } = renderHook(() => useListViewState(store));
    expect(result.current.initialFilter).toEqual({ name: '甲' });
    expect(result.current.initialRestoreIndex).toBe(3);

    act(() => result.current.saveFilter({ name: '乙' }));

    expect(result.current.initialFilter).toEqual({ name: '甲' });
    expect(store.filter).toEqual({ name: '乙' });
  });

  it('resetListViewState 复位 store', () => {
    const store = createListViewState<Filter>();
    const { result } = renderHook(() => useListViewState(store));
    act(() => {
      result.current.saveFilter({ name: '甲' });
      result.current.saveFirstVisibleIndex(9);
    });

    resetListViewState(store);

    expect(store.filter).toEqual({});
    expect(store.firstVisibleIndex).toBe(0);
  });
});
