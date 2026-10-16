import type { CursorPageResult } from '@lucy/shared';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCursorList } from './infinite-cache';

/**
 * 只桩掉 `useInfiniteQuery`，其余（`useQueryClient` 等）保持真身：
 * 本用例要断言的就是「传进 options 的东西」。因为不真跑查询，也就不需要 QueryClientProvider。
 */
const useInfiniteQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...mod, useInfiniteQuery: useInfiniteQueryMock };
});

type Row = { id: string };

const fetchPage = (): Promise<CursorPageResult<Row>> =>
  Promise.resolve({ list: [], nextCursor: null });

/** 取最近一次传进 useInfiniteQuery 的 options */
function lastOptions() {
  return useInfiniteQueryMock.mock.calls.at(-1)?.[0] as {
    placeholderData?: unknown;
  };
}

describe('useCursorList options', () => {
  beforeEach(() => {
    useInfiniteQueryMock.mockReset();
    useInfiniteQueryMock.mockReturnValue({});
  });

  it('placeholderData 引用跨渲染保持稳定（内联恒等闭包会让 options 每轮都变）', () => {
    const { rerender } = renderHook(() =>
      useCursorList<Row>({ queryKey: ['t'], fetchPage }),
    );

    const first = lastOptions().placeholderData;
    // 触发一次重渲染：内联 `(prev) => prev` 在这里就会产生新引用
    rerender();
    const second = lastOptions().placeholderData;

    expect(typeof first).toBe('function');
    expect(second).toBe(first);
  });

  it('keepPreviousData: false 时不提供 placeholderData', () => {
    renderHook(() =>
      useCursorList<Row>({
        queryKey: ['t'],
        fetchPage,
        keepPreviousData: false,
      }),
    );

    expect(lastOptions().placeholderData).toBeUndefined();
  });
});
