import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { RERANK_REFERENCE_PORT } from './rerank-reference.port.js';
import { RerankReferenceService } from './rerank-reference.service.js';

/**
 * 只承载「其它领域可以触发、但落库仍归知识库」的窄能力，供 ModelProviderModule
 * 注入——这样 ModelProviderModule 不必 import 知识库实体或知识库主模块，
 * 依赖方向仍是 knowledge → model-provider。
 *
 * `forFeature([KnowledgeBase])` 让实体注册显式化，不再依赖 `autoLoadEntities`
 * 的隐式全局注册。
 */
@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
  providers: [
    { provide: RERANK_REFERENCE_PORT, useClass: RerankReferenceService },
  ],
  exports: [RERANK_REFERENCE_PORT],
})
export class KnowledgeReferencesModule {}
