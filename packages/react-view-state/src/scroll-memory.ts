/**
 * 滚动位置记忆：模块级的纵向偏移缓存。
 *
 * 与 `<PageStateCache>` 同一思路（页面卸载后保留、登出统一清空、内存态 F5 即清空），
 * 但刻意**不经过 React 订阅**——滚动中每帧都会写回，走 store 订阅会把整页拖进重渲染。
 * key 与 PageStateCache 的 `cacheKey` 同值，语义是「同一个页面」。
 */

/** key -> 纵向滚动偏移（px）。页面卸载后不清理，这就是「缓存」本体 */
const offsets = new Map<string, number>();

/**
 * 读取已记忆的偏移。
 *
 * @param key 记忆标识（与 PageStateCache 的 cacheKey 同值）
 * @returns 已记录的偏移；没有记录时按 0 处理
 */
export function readScrollOffset(key: string): number {
  return offsets.get(key) ?? 0;
}

/**
 * 写入已记忆的偏移（滚动事件里持续调用）。
 *
 * @param key 记忆标识
 * @param offset 纵向滚动偏移（px）
 */
export function writeScrollOffset(key: string, offset: number): void {
  offsets.set(key, offset);
}

/**
 * 清除某个 key 的记忆（下次进入从顶部开始）。
 *
 * @param key 记忆标识
 */
export function clearScrollOffset(key: string): void {
  offsets.delete(key);
}

/** 清空全部滚动记忆（登出 / 会话过期时调用，避免下一个账号读到上一个账号的位置） */
export function clearAllScrollOffsets(): void {
  offsets.clear();
}
