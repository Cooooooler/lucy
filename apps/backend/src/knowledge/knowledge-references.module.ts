import { Module } from '@nestjs/common';
import { RERANK_REFERENCE_PORT } from '../common/ports/rerank-reference.port.js';
import { RerankReferenceService } from './rerank-reference.service.js';

/**
 * 模型域需要的窄能力：清空指向某个模型的知识库重排引用。
 *
 * 端口定义在 common（中立位置），实现在知识库领域，由 ModelProviderModule
 * 显式 import——依赖边在模块图上可见，不用 @Global 隐式注入。
 *
 * 注意 feature 级是双向依赖：本模块不 import ModelProviderModule，但
 * `KnowledgeModule` 会 import `ModelProviderModule`；靠把「清空引用」拆成这个
 * 独立模块，Nest 侧才不会成环。不要把它并回 `KnowledgeModule`。
 */
@Module({
  providers: [
    { provide: RERANK_REFERENCE_PORT, useClass: RerankReferenceService },
  ],
  exports: [RERANK_REFERENCE_PORT],
})
export class KnowledgeReferencesModule {}
