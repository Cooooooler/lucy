import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackendFileEntity } from './entities/backend-file.entity.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeLike } from './entities/knowledge-like.entity.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [
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
