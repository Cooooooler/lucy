import type { components } from '@lucy/shared';

// API 契约类型：从后端 Swagger 生成的 components.schemas 派生，勿手改字段
export type User = components['schemas']['User'];
export type HealthResult = components['schemas']['HealthResultDto'];
export type RefreshResult = components['schemas']['RefreshResultDto'];
export type LoginResult = components['schemas']['LoginResultDto'];
export type LoginRequest = components['schemas']['LoginDto'];
export type RegisterRequest = components['schemas']['RegisterDto'];
export type CreateConversationRequest =
  components['schemas']['CreateConversationDto'];
export type SendMessageRequest = components['schemas']['SendMessageDto'];
export type RenameConversationRequest =
  components['schemas']['RenameConversationDto'];
export type Conversation = components['schemas']['Conversation'];
export type Message = components['schemas']['Message'];
export type MessageRole = Message['role'];
export type MessageStatus = Message['status'];
export type ConversationListResult =
  components['schemas']['ConversationListResultDto'];

// 知识库：契约类型来自后端 Swagger 生成的 components.schemas
export type KnowledgeBase = components['schemas']['KnowledgeBase'];
export type KnowledgeBaseVisibility = KnowledgeBase['visibility'];
export type CreateKnowledgeBaseRequest =
  components['schemas']['CreateKnowledgeBaseDto'];
export type UpdateKnowledgeBaseRequest =
  components['schemas']['UpdateKnowledgeBaseDto'];

// KnowledgeDocument：由后端文档接口 @ApiResponse({ type: KnowledgeDocument })
// 生成（Swagger 已将字段推给该 schema），勿手写。
export type KnowledgeDocument = components['schemas']['KnowledgeDocument'];
