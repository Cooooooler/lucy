import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [
    CommonModule,
    // KeysetPaginator 与知识库无耦合，由 common 侧的模块提供，这里只消费
    PaginationModule,
    TypeOrmModule.forFeature([
      KnowledgeBase,
      KnowledgeDocument,
      BackendFileEntity,
      KnowledgeLike,
    ]),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
