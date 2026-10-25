import type { EntityManager } from 'typeorm';

/**
 * 知识库侧对「重排模型引用」的窄端口。
 *
 * 模型域（model-provider）在模型被改成非 rerank 类型时需要清空知识库里指向它的
 * 引用，但 `knowledge_bases` 的写入应由知识领域独占：模型域只依赖这个接口 + 注入
 * token，不 import 实体、也不写别的领域的表。
 */
export const RERANK_REFERENCE_PORT = Symbol('RERANK_REFERENCE_PORT');

export interface RerankReferencePort {
  /** 在调用方事务内把指向该模型的重排引用置空（同步刷新 updated_at） */
  clearForModel(manager: EntityManager, modelId: string): Promise<void>;
}
