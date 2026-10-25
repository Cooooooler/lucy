import { Module } from '@nestjs/common';
import { RERANK_REFERENCE_PORT } from '../common/ports/rerank-reference.port.js';
import { RerankReferenceService } from './rerank-reference.service.js';

/**
 * 模型域需要的窄能力：清空指向某个模型的知识库重排引用。
 *
 * 端口定义在 common（中立位置），实现在知识库领域，由 ModelProviderModule
 * 显式 import——依赖边在模块图上可见，不再用 @Global 隐式注入；该模块不反向
 * import ModelProviderModule，模块图无环。
 */
@Module({
  providers: [
    { provide: RERANK_REFERENCE_PORT, useClass: RerankReferenceService },
  ],
  exports: [RERANK_REFERENCE_PORT],
})
export class KnowledgeReferencesModule {}
