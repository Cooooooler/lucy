import type { CursorPageResult, ModelProviderListQuery } from '@lucy/shared';
import { http } from './client.js';
import type {
  CreateModelProviderRequest,
  ModelProvider,
  TestConnectionResult,
  UpdateModelProviderRequest,
} from './types.js';

// 模型供应商 REST 客户端：全部经 http 实例（自动附加 Bearer + 401 单飞刷新 + 信封解包）。
// 列表为游标分页，响应复用共享 CursorPageResult<T>（nextCursor 为空表示已到末页）。
// 查询参数类型（ModelProviderListQuery）由共享包从生成的 operations 派生导出。

export function createModelProviderApi(input: CreateModelProviderRequest) {
  return http.post<ModelProvider>('model-providers', input).json();
}

export function listModelProvidersApi(query: ModelProviderListQuery = {}) {
  return http
    .get<CursorPageResult<ModelProvider>>('model-providers', query)
    .json();
}

export function getModelProviderApi(id: string) {
  return http.get<ModelProvider>(`model-providers/${id}`).json();
}

export function updateModelProviderApi(
  id: string,
  input: UpdateModelProviderRequest,
) {
  return http.patch<ModelProvider>(`model-providers/${id}`, input).json();
}

export function deleteModelProviderApi(id: string) {
  return http.delete<null>(`model-providers/${id}`).json();
}

// 连接测试：结果（ok/失败原因）由调用方按 ok 展示，跳过全局成功提示桥
export function testModelProviderConnectionApi(id: string) {
  return http
    .post<TestConnectionResult>(
      `model-providers/${id}/test-connection`,
      undefined,
      {
        extra: { skipSuccessMessage: true },
      },
    )
    .json();
}
