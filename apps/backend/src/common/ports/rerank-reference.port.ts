import type { EntityManager } from 'typeorm';

/**
 * 知识库重排引用的窄端口（定义在中立位置，由消费方 model-provider 依赖）。
 *
 * 模型被改成非 rerank 类型或删除时需要清空知识库里指向它的引用，但
 * `knowledge_bases` 的写入应由知识领域独占：模型域只依赖这个接口 + 注入 token。
 *
 * 实际接线（feature 级是双向依赖，靠拆分 module 保环）：
 * - `ModelProviderModule` → `KnowledgeReferencesModule`（拿实现）
 * - `KnowledgeModule` → `ModelProviderModule`（复用模型解析）
 * 两个 feature 模块互不直接引用对方的 `.module.ts` 之外的实体/服务，Nest 模块图
 * 因此无环；**不要**把 `KnowledgeReferencesModule` 并回 `KnowledgeModule` 或改回
 * `@Global`，前者会立刻形成循环模块依赖。
 */
export const RERANK_REFERENCE_PORT = Symbol('RERANK_REFERENCE_PORT');

export interface RerankReferencePort {
  /** 在调用方事务内把指向该模型的重排引用置空（同步刷新 updated_at） */
  clearForModel(manager: EntityManager, modelId: string): Promise<void>;
}
