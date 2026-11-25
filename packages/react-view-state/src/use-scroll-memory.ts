import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  clearScrollOffset,
  readScrollOffset,
  writeScrollOffset,
} from './scroll-memory';

/**
 * 恢复方式：
 * - `'dom'`（默认）：hook 自己写 `scrollTop`，适用于普通滚动容器；
 * - `'delegate'`：hook 只回传待恢复偏移，由虚拟化列表内部对齐（它还要同步虚拟化器
 *   的内部 offset，只写 DOM 会先按旧位置挂一整窗卡片）。
 */
export type ScrollMemoryRestoreMode = 'dom' | 'delegate';

/** 滚动位置记忆的配置项 */
export type ScrollMemoryOptions = {
  /** 记忆标识；同一 key 的滚动容器共享位置（与 PageStateCache 的 cacheKey 同值） */
  cacheKey: string;
  /** 滚动容器；变化时重新绑定监听 */
  scrollElement: HTMLElement | null;
  /** 默认 `'dom'` */
  restoreMode?: ScrollMemoryRestoreMode;
  /** `'dom'` 模式：内容已渲染、高度真实后才恢复，避免按骨架高度把位置截断 */
  ready?: boolean;
};

/** `useScrollMemory` 的返回值：待恢复偏移、消费回调与回顶方法 */
export type ScrollMemory = {
  /** 本次挂载待恢复的偏移；null = 无需恢复或已消费 */
  restoreOffset: number | null;
  /** `'delegate'` 模式：消费方对齐完成后调用，避免重挂时回放旧锚点 */
  consumeRestore: () => void;
  /** 清空记忆并回到顶部（筛选变化 / 手动刷新共用） */
  resetToTop: () => void;
};

/**
 * 记住滚动容器的位置：离开页面后再次进入时恢复。
 *
 * 保存走模块级 Map（不触发渲染），恢复是一次性的：消费后本次挂载不再回放，
 * 否则 `resetToTop` 的 `scrollTo({ top: 0 })` 会被旧锚点覆盖。
 *
 * `cacheKey` 在组件生命周期内应保持稳定（与 `useState` 首值同理，初值只读一次）。
 *
 * @param options 记忆 key、滚动容器、恢复方式与就绪标记，见 {@link ScrollMemoryOptions}
 * @returns 待恢复偏移、消费回调与回顶方法，见 {@link ScrollMemory}
 */
export function useScrollMemory({
  cacheKey,
  scrollElement,
  restoreMode = 'dom',
  ready = true,
}: ScrollMemoryOptions): ScrollMemory {
  // 首帧就读锚点：路由重新挂载时立刻把偏移交给消费方，不必等 effect 补一帧
  const [restoreOffset, setRestoreOffset] = useState<number | null>(() => {
    const saved = readScrollOffset(cacheKey);
    return saved > 0 ? saved : null;
  });

  // 滚动中持续写回：只改模块级 Map，不需要节流，也不会触发渲染
  useEffect(() => {
    if (!scrollElement) return;
    const save = () => writeScrollOffset(cacheKey, scrollElement.scrollTop);
    scrollElement.addEventListener('scroll', save, { passive: true });
    return () => scrollElement.removeEventListener('scroll', save);
  }, [cacheKey, scrollElement]);

  const consumeRestore = useCallback(() => setRestoreOffset(null), []);

  // 普通容器的恢复：布局阶段写 scrollTop，paint 前完成，不闪
  useLayoutEffect(() => {
    if (restoreMode !== 'dom' || !ready || !scrollElement) return;
    if (restoreOffset == null) return;
    scrollElement.scrollTop = restoreOffset;
    // 一次性：之后的重挂载不再回放（否则会把 resetToTop 覆盖掉）
    // eslint-disable-next-line react-x/set-state-in-effect -- 恢复是一锤子动作，需要同步把锚点置空
    setRestoreOffset(null);
  }, [ready, restoreMode, restoreOffset, scrollElement]);

  const resetToTop = useCallback(() => {
    clearScrollOffset(cacheKey);
    setRestoreOffset(null);
    scrollElement?.scrollTo({ top: 0 });
  }, [cacheKey, scrollElement]);

  return { restoreOffset, consumeRestore, resetToTop };
}
