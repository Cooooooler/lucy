import { Module } from '@nestjs/common';
import { RERANK_REFERENCE_PORT } from '../common/ports/rerank-reference.port.js';
import { RerankReferenceService } from './rerank-reference.service.js';

/**
 * 模型域需要的窄能力：清空指向某个模型的知识库重排引用。
 *
 * 端口定义在 common（中立位置），实现在知识库领域，由 ModelProviderModule
 * 显式 import——依赖边在模块图上可见，不用 @Global 隐式注入。
 *
 * 本模块是两个 feature 双向依赖之间唯一的断点：
 * `ModelProviderModule` import 本模块，`KnowledgeModule` import `ModelProviderModule`。
 * **禁止**让本模块 import `KnowledgeModule` / `ModelProviderModule`，也不要把它
 * 并回 `KnowledgeModule`——任一改动都会立刻形成循环模块依赖。
 */
@Module({
  providers: [
    { provide: RERANK_REFERENCE_PORT, useClass: RerankReferenceService },
  ],
  exports: [RERANK_REFERENCE_PORT],
})
export class KnowledgeReferencesModule {}
