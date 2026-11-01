import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import { ModelProviderModule } from '../model-provider/model-provider.module.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [
    CommonModule,
    // KeysetPaginator 与知识库无耦合，由 common 侧的模块提供，这里只消费
    PaginationModule,
    // 创建知识库时校验所选重排模型的属主与类型（解析逻辑收敛在模型领域）
    ModelProviderModule,
    TypeOrmModule.forFeature([
      KnowledgeBase,
      KnowledgeDocument,
      BackendFileEntity,
      KnowledgeLike,
    ]),
  ],
  controllers: [KnowledgeController],
  // 知识库元信息（KnowledgeService）与文档处理（KnowledgeDocumentService）分属两个职责
  providers: [KnowledgeService, KnowledgeDocumentService],
})
export class KnowledgeModule {}
