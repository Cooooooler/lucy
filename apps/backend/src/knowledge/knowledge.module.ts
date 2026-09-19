import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { KeysetPaginator } from './keyset-paginator.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      KnowledgeBase,
      KnowledgeDocument,
      BackendFileEntity,
      KnowledgeLike,
    ]),
  ],
  controllers: [KnowledgeController],
  // KeysetPaginator：与实体/授权/存储无关的游标分页装配，独立成 provider 便于复用与单测
  providers: [KnowledgeService, KeysetPaginator],
})
export class KnowledgeModule {}
