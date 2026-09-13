import { resetKnowledgeViewState } from './hooks/use-knowledge-view-state';
import { queryClient } from './queryClient';

/**
 * 会话结束（登出 / 会话过期）时的客户端缓存复位。
 * 必要性：列表缓存默认保留 5 分钟且重挂载不自动重取，模块级视图 store 也存有上次的筛选；
 * 若不清，同一标签页换账号后会零请求地看到上一个账号的筛选与列表数据。
 */
export function resetClientCaches() {
  queryClient.clear();
  resetKnowledgeViewState();
}
