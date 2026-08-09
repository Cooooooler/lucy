import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ContextService } from './context.service.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';
import { TokenizerService } from './tokenizer.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message])],
  controllers: [AiController],
  providers: [AiService, OllamaFactory, TokenizerService, ContextService],
})
export class AiModule {}
