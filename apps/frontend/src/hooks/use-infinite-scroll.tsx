import { Button, Empty, Result, Spin } from 'antd';
import {
  type FC,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from 'react';

type InfiniteScrollState<T> = {
  data: { pages: { list: T[] }[] } | undefined;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  fetchNextPage: () => void;
  refetch: () => void;
};

type UseInfiniteScrollContentOptions<T> = {
  query: InfiniteScrollState<T>;
  renderList: (items: T[]) => ReactNode;
  emptyText?: { filtered: string; default: string };
  hasFilter?: boolean;
  rootMargin?: string;
};

type UseInfiniteScrollContentReturn<T> = {
  scrollRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
  items: T[];
  content: ReactNode;
};

const FetchingText: FC = () => (
  <div className="flex items-center justify-center gap-2 py-16">
    <Spin size="small" />
    <div className="text-sm text-gray-400">加载中</div>
  </div>
);

/**
 * 无限滚动内容渲染 hook。
 * 监听 sentinel 元素进入视口时自动加载下一页，统一处理 loading/error/empty/列表状态。
 */
export function useInfiniteScrollContent<T>({
  query,
  renderList,
  emptyText = { filtered: '没有匹配的结果', default: '暂无数据' },
  hasFilter = false,
  rootMargin = '0px 0px 250px 0px',
}: UseInfiniteScrollContentOptions<T>): UseInfiniteScrollContentReturn<T> {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    fetchNextPage,
    refetch,
  } = query;

  const items = useMemo(
    () => (data?.pages.flatMap((p) => p.list) ?? []) as T[],
    [data],
  );

  const fetchingRef = useRef(false);
  useEffect(() => {
    fetchingRef.current = isFetchingNextPage;
  }, [isFetchingNextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    if (!hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || !hasNextPage) return;
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        fetchNextPage();
      },
      { root, rootMargin, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, isLoading, rootMargin, items.length]);

  let content: ReactNode;
  if (isLoading) {
    content = <FetchingText />;
  } else if (isError) {
    content = (
      <Result
        status="error"
        title="加载失败"
        subTitle={error instanceof Error ? error.message : '请稍后重试'}
        extra={
          <Button type="link" onClick={() => refetch()} className="text-sm">
            重试
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    content = (
      <Empty
        className="py-16"
        description={hasFilter ? emptyText.filtered : emptyText.default}
      />
    );
  } else {
    let sentinelContent: ReactNode = null;
    if (isFetchingNextPage) {
      sentinelContent = <FetchingText />;
    } else if (!hasNextPage) {
      sentinelContent = (
        <span className="text-sm text-gray-400">已加载全部</span>
      );
    }

    content = (
      <>
        {renderList(items)}
        <div
          ref={sentinelRef}
          className="flex h-12 items-center justify-center py-4"
        >
          {sentinelContent}
        </div>
      </>
    );
  }

  return { scrollRef, sentinelRef, items, content };
}
