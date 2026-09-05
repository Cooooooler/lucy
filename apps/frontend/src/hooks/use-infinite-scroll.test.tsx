import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInfiniteScrollContent } from './use-infinite-scroll';

/** 构建 mock query 状态 */
function mockQuery(overrides: {
  data?: { pages: { list: string[] }[] };
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}) {
  return {
    data: overrides.data,
    hasNextPage: overrides.hasNextPage ?? false,
    isFetchingNextPage: overrides.isFetchingNextPage ?? false,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: overrides.error ?? null,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

describe('useInfiniteScrollContent', () => {
  it('加载中时显示 loading', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({ isLoading: true, hasNextPage: true }),
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('加载中');
  });

  it('渲染列表数据并扁平化多页', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({
          data: { pages: [{ list: ['a', 'b'] }, { list: ['c'] }] },
        }),
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    expect(result.current.items).toEqual(['a', 'b', 'c']);
  });

  it('错误时显示错误内容与重试按钮', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({ isError: true, error: new Error('请求失败') }),
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('加载失败');
    expect(container.textContent).toContain('请求失败');
  });

  it('空数据时显示 default empty', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({ data: { pages: [{ list: [] }] } }),
        renderList: (items) => <div>{items.join(',')}</div>,
        emptyText: { filtered: '没有匹配', default: '暂无数据' },
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('暂无数据');
  });

  it('有筛选且空数据时显示 filtered empty', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({ data: { pages: [{ list: [] }] } }),
        renderList: (items) => <div>{items.join(',')}</div>,
        emptyText: { filtered: '没有匹配', default: '暂无数据' },
        hasFilter: true,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('没有匹配');
  });

  it('加载完全部时显示「已加载全部」', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({
          data: { pages: [{ list: ['a'] }] },
          hasNextPage: false,
        }),
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('已加载全部');
  });

  it('加载下一页时 sentinel 显示 loading', () => {
    const { result } = renderHook(() =>
      useInfiniteScrollContent({
        query: mockQuery({
          data: { pages: [{ list: ['a'] }] },
          hasNextPage: true,
          isFetchingNextPage: true,
        }),
        renderList: (items) => <div>{items.join(',')}</div>,
      }),
    );
    const { container } = render(<div>{result.current.content}</div>);
    expect(container.textContent).toContain('加载中');
  });
});
