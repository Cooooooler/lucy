import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import { KnowledgeReferencesModule } from '../knowledge/knowledge-references.module.js';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import { ModelProvider } from './entities/model-provider.entity.js';
import { UserDefaultModel } from './entities/user-default-model.entity.js';
import { ModelClientFactory } from './model-client.factory.js';
import { ModelConnectionService } from './model-connection.service.js';
import { ModelProviderDefaultsService } from './model-provider-defaults.service.js';
import { ModelProviderController } from './model-provider.controller.js';
import { ModelProviderService } from './model-provider.service.js';

@Module({
  imports: [
    CommonModule,
    // KeysetPaginator 与领域无关，由 common 侧的模块提供，这里只消费
    PaginationModule,
    // RERANK_REFERENCE_PORT：知识库侧实现、这里显式引入（无反向依赖，不成环）
    KnowledgeReferencesModule,
    TypeOrmModule.forFeature([ModelProvider, UserDefaultModel]),
  ],
  controllers: [ModelProviderController],
  // 元信息 CRUD / 加密 / 客户端工厂 / 连接测试各司其职
  providers: [
    ModelProviderService,
    ModelProviderDefaultsService,
    ApiKeyCipher,
    ModelClientFactory,
    ModelConnectionService,
  ],
  // 导出给 AI 对话复用：工厂按属主配置构造对话客户端，服务提供属主/类型受限的模型解析
  exports: [ModelClientFactory, ModelProviderService],
})
export class ModelProviderModule {}
