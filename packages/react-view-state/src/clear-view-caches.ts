import { clearPageStateCaches } from './page-state-cache';
import { clearAllScrollOffsets } from './scroll-memory';

/**
 * 清空本库的全部内存缓存：页面状态（筛选、视图状态…）与滚动位置。
 *
 * 登出 / 会话过期时调用，避免下一个账号读到上一个账号的页面状态与滚动位置。
 * 需要单独清理时再用 `clearPageStateCaches` / `clearAllScrollOffsets`。
 */
export function clearViewCaches(): void {
  clearPageStateCaches();
  clearAllScrollOffsets();
}
