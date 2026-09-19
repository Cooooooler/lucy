import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ContextService } from './context.service.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';
import { TokenizerService } from './tokenizer.service.js';

@Module({
  imports: [
    CommonModule,
    // KeysetPaginator 与 AI 无耦合，由 common 侧的模块提供，这里只消费（会话列表用它分页）
    PaginationModule,
    TypeOrmModule.forFeature([Conversation, Message]),
  ],
  controllers: [AiController],
  providers: [AiService, OllamaFactory, TokenizerService, ContextService],
})
export class AiModule {}
