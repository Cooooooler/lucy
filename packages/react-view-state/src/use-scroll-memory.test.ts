import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllScrollOffsets,
  readScrollOffset,
  writeScrollOffset,
} from './scroll-memory';
import { useScrollMemory } from './use-scroll-memory';

/**
 * jsdom 没有布局盒：`scrollTop` 的 setter 不保存值、`scrollHeight/clientHeight`
 * 恒为 0。用可写数据属性替换成能被断言的内存值。
 */
function makeScrollElement(initialTop = 0): HTMLDivElement {
  const element = document.createElement('div');
  let scrollTop = initialTop;
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
    configurable: true,
  });
  return element;
}

describe('useScrollMemory', () => {
  beforeEach(() => {
    clearAllScrollOffsets();
    vi.restoreAllMocks();
  });

  it('dom 模式：内容就绪后恢复到记忆位置，并消费锚点', () => {
    writeScrollOffset('list', 320);
    const element = makeScrollElement();

    const { result } = renderHook(() =>
      useScrollMemory({
        cacheKey: 'list',
        scrollElement: element,
        ready: true,
      }),
    );

    expect(element.scrollTop).toBe(320);
    expect(result.current.restoreOffset).toBeNull();
  });

  it('dom 模式：ready 之前不恢复，就绪后只恢复一次', () => {
    writeScrollOffset('list', 320);
    const element = makeScrollElement();
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useScrollMemory({ cacheKey: 'list', scrollElement: element, ready }),
      { initialProps: { ready: false } },
    );

    expect(element.scrollTop).toBe(0);
    expect(result.current.restoreOffset).toBe(320);

    rerender({ ready: true });
    expect(element.scrollTop).toBe(320);
    expect(result.current.restoreOffset).toBeNull();

    // 已消费：用户之后滚走、再重渲染也不会被拉回锚点
    act(() => {
      element.scrollTop = 40;
    });
    rerender({ ready: true });
    expect(element.scrollTop).toBe(40);
  });

  it('没有记忆（或记忆为 0）时不恢复', () => {
    const element = makeScrollElement();
    const { result } = renderHook(() =>
      useScrollMemory({ cacheKey: 'empty', scrollElement: element }),
    );

    expect(element.scrollTop).toBe(0);
    expect(result.current.restoreOffset).toBeNull();
  });

  it('滚动时持续写回记忆；卸载后不再写', () => {
    const element = makeScrollElement();
    const { unmount } = renderHook(() =>
      useScrollMemory({ cacheKey: 'list', scrollElement: element }),
    );

    act(() => {
      element.scrollTop = 210;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(readScrollOffset('list')).toBe(210);

    unmount();

    act(() => {
      element.scrollTop = 640;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(readScrollOffset('list')).toBe(210);
  });

  it('resetToTop：清空记忆、回顶，并作废本次挂载的恢复锚点', () => {
    writeScrollOffset('list', 320);
    const element = makeScrollElement();
    const scrollTo = vi.spyOn(element, 'scrollTo');
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useScrollMemory({ cacheKey: 'list', scrollElement: element, ready }),
      // 模拟「内容还在加载时点刷新」：锚点尚未被消费
      { initialProps: { ready: false } },
    );
    expect(result.current.restoreOffset).toBe(320);

    act(() => result.current.resetToTop());

    expect(readScrollOffset('list')).toBe(0);
    expect(result.current.restoreOffset).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });

    // 内容就绪后也不会再回放旧锚点，把 resetToTop 的归零覆盖掉
    rerender({ ready: true });
    expect(element.scrollTop).toBe(0);
  });

  it('delegate 模式：只回传锚点，不写 DOM；consumeRestore 后置空', () => {
    writeScrollOffset('list', 320);
    const element = makeScrollElement();
    const { result } = renderHook(() =>
      useScrollMemory({
        cacheKey: 'list',
        scrollElement: element,
        restoreMode: 'delegate',
      }),
    );

    expect(result.current.restoreOffset).toBe(320);
    expect(element.scrollTop).toBe(0);

    act(() => result.current.consumeRestore());
    expect(result.current.restoreOffset).toBeNull();
  });
});
