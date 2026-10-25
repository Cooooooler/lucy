import type { EntityManager } from 'typeorm';

/**
 * 知识库重排引用的窄端口（定义在中立位置，由消费方 model-provider 依赖）。
 *
 * 模型被改成非 rerank 类型或删除时需要清空知识库里指向它的引用，但
 * `knowledge_bases` 的写入应由知识领域独占：模型域只依赖本接口 + 注入 token，
 * 实现（`RerankReferenceService`）留在 knowledge 目录，模块全局注册，
 * 因此 model-provider 不必 import 知识库目录，模块依赖保持单向。
 */
export const RERANK_REFERENCE_PORT = Symbol('RERANK_REFERENCE_PORT');

export interface RerankReferencePort {
  /** 在调用方事务内把指向该模型的重排引用置空（同步刷新 updated_at） */
  clearForModel(manager: EntityManager, modelId: string): Promise<void>;
}
