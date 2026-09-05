import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInfiniteScrollContent } from './use-infinite-scroll';

describe('useInfiniteScrollContent', () => {
  it('加载中时显示 loading', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: {
          data: undefined,
          hasNextPage: true,
          isFetchingNextPage: false,
          isLoading: true,
          isError: false,
          error: null,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        },
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('加载中');
  });

  it('渲染列表数据', () => {
    const { result } = renderHook(() => {
      const query = {
        data: { pages: [{ list: ['a', 'b'] }, { list: ['c'] }] },
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: false,
        error: null,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
      return useInfiniteScrollContent({
        query,
        renderList: (items) => <div>{items.join(',')}</div>,
      });
    });
    expect(result.current.items).toEqual(['a', 'b', 'c']);
  });

  it('错误时显示错误内容', () => {
    const { result } = renderHook(() => {
      const query = {
        data: undefined,
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: true,
        error: new Error('请求失败'),
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
      return useInfiniteScrollContent({
        query,
        renderList: (items) => <div>{items.join(',')}</div>,
      });
    });
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('加载失败');
    expect(container.textContent).toContain('请求失败');
  });

  it('空数据时显示 empty', () => {
    const { result } = renderHook(() => {
      const query = {
        data: { pages: [{ list: [] }] },
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: false,
        error: null,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
      return useInfiniteScrollContent({
        query,
        renderList: (items) => <div>{items.join(',')}</div>,
        emptyText: { filtered: '没有匹配', default: '暂无数据' },
      });
    });
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('暂无数据');
  });

  it('有筛选且空数据时显示 filtered empty', () => {
    const { result } = renderHook(() => {
      const query = {
        data: { pages: [{ list: [] }] },
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: false,
        error: null,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
      return useInfiniteScrollContent({
        query,
        renderList: (items) => <div>{items.join(',')}</div>,
        emptyText: { filtered: '没有匹配', default: '暂无数据' },
        hasFilter: true,
      });
    });
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('没有匹配');
  });
});
