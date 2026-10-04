import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import { ModelProviderModule } from '../model-provider/model-provider.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ChatStreamService } from './chat-stream.service.js';
import { ContextService } from './context.service.js';
import { ConversationTitleService } from './conversation-title.service.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { TokenizerService } from './tokenizer.service.js';

@Module({
  imports: [
    CommonModule,
    // KeysetPaginator 与 AI 无耦合，由 common 侧的模块提供，这里只消费（会话列表用它分页）
    PaginationModule,
    // 复用模型领域：ModelClientFactory（按 vendor 构造客户端）+ ModelProviderService（属主/类型受限解析）
    ModelProviderModule,
    TypeOrmModule.forFeature([Conversation, Message]),
  ],
  controllers: [AiController],
  // 会话元信息（AiService）与流式生成（ChatStreamService）分属两个职责
  providers: [
    AiService,
    ChatStreamService,
    ConversationTitleService,
    TokenizerService,
    ContextService,
  ],
})
export class AiModule {}
