import { useCallback, useState } from 'react';

/**
 * 从「该 mutation 是否在跑 + 它的 variables」取出正在处理的条目 id。
 *
 * 用于把路由持有的 mutation pending 态整理成网格的 `pendingIds`：
 * 删除类 mutation 的入参是 id 字符串，更新类是 `{ id, input }`，两种形态都要能取。
 */
export function pendingIdOf(
  isPending: boolean,
  variables: string | { id: string } | undefined,
): string | null {
  if (!isPending || !variables) return null;
  return typeof variables === 'string' ? variables : variables.id;
}

/**
 * 卡片列表路由的公共件：恢复锚点、滚动容器、以及「回顶 + 作废锚点 + 写回筛选」这三件
 * 永远一起发生的事。
 *
 * 只抽原语——领域 mutation（点赞/可见性/测试连接）与各自的 handler 仍留在路由里显式组装，
 * 避免退化成配置对象。
 */
export function useListPageChrome<TFilter extends object>({
  initialRestoreIndex,
  saveFilter,
}: {
  initialRestoreIndex: number;
  saveFilter: (patch: Partial<TFilter>) => void;
}) {
  // 恢复锚点只在路由本次挂载后消费一次：恢复完成后置 0。
  // 必须由路由持有而非网格自己记账——网格仍会因加载态/空态卸载重挂
  // （首次加载、以及「改筛选后新条件无结果」等分支），网格内的「已恢复」标记会随实例归零，
  // 于是旧锚点被再次回放，把 resetToTop 的 scrollTo({ top: 0 }) 覆盖掉。
  const [restoreIndex, setRestoreIndex] = useState(initialRestoreIndex);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  /** 网格的 onRestoreDone：本次挂载的恢复动作已结束，消费掉锚点 */
  const consumeRestore = useCallback(() => setRestoreIndex(0), []);

  /**
   * 回到列表顶部并作废恢复锚点。
   * 换筛选与手动刷新都必须在同一个动作里做这两件事，否则新数据回来后会被恢复到旧位置。
   */
  const resetToTop = useCallback(() => {
    setRestoreIndex(0);
    scrollElement?.scrollTo({ top: 0 });
  }, [scrollElement]);

  /**
   * 筛选变更：回顶 + 作废锚点 + 写回会话 store。
   *
   * 直接写进「改变筛选的用户事件」里，不再用 filterKey 派生值 + effect：
   * 筛选只可能由这些事件改变，用 effect 比对「上一次 key」是对同一动作的重复建模，
   * 还多一趟 effect 与一个纯记账 ref。放进事件处理器天然满足「挂载时不归零」
   * （挂载不触发这些处理器），因此不会与首可见项恢复互相打架。
   */
  const onFilterChange = useCallback(
    (patch: Partial<TFilter>) => {
      resetToTop();
      saveFilter(patch);
    },
    [resetToTop, saveFilter],
  );

  return {
    restoreIndex,
    consumeRestore,
    scrollElement,
    setScrollElement,
    resetToTop,
    onFilterChange,
  };
}
