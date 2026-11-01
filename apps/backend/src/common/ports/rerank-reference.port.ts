import type { EntityManager } from 'typeorm';

/**
 * 知识库重排引用的窄端口（定义在中立位置，由消费方 model-provider 依赖）。
 *
 * 模型被改成非 rerank 类型或删除时需要清空知识库里指向它的引用，但
 * `knowledge_bases` 的写入应由知识领域独占：模型域只依赖这个接口 + 注入 token。
 *
 * 实际接线（feature 级是双向依赖，靠拆分 module 保环）：
 * - `ModelProviderModule` → import `KnowledgeReferencesModule`（拿实现）
 * - `KnowledgeService` → 注入 `ModelProviderService`（复用重排模型解析）
 * - `KnowledgeModule` → import `ModelProviderModule`
 * `KnowledgeReferencesModule` 刻意不 import 任何 feature module，因此它是这两个
 * 双向依赖之间唯一的「断点」。**不要**把它并回 `KnowledgeModule`、改回 `@Global`
 * 或让它 import `ModelProviderModule`，任一改动都会形成循环模块依赖。
 */
export const RERANK_REFERENCE_PORT = Symbol('RERANK_REFERENCE_PORT');

export interface RerankReferencePort {
  /** 在调用方事务内把指向该模型的重排引用置空（同步刷新 updated_at） */
  clearForModel(manager: EntityManager, modelId: string): Promise<void>;
}
