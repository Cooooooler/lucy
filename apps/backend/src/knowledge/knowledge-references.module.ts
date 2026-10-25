import { Global, Module } from '@nestjs/common';
import { RERANK_REFERENCE_PORT } from '../common/ports/rerank-reference.port.js';
import { RerankReferenceService } from './rerank-reference.service.js';

/**
 * 模型域需要的窄能力：清空指向某个模型的知识库重排引用。
 *
 * 端口定义在 common（中立位置），实现在知识库领域。这里做成全局模块、由
 * AppModule 注册一次：ModelProviderModule 直接注入 token，不需要 import
 * 知识库目录，模块依赖保持单向（knowledge → model-provider）。
 */
@Global()
@Module({
  providers: [
    { provide: RERANK_REFERENCE_PORT, useClass: RerankReferenceService },
  ],
  exports: [RERANK_REFERENCE_PORT],
})
export class KnowledgeReferencesModule {}
