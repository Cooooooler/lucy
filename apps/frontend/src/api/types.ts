import type { components } from '@lucy/shared';

// API 契约类型：从后端 Swagger 生成的 components.schemas 派生，勿手改字段
export type User = components['schemas']['User'];
export type UpdateUserStatusRequest =
  components['schemas']['UpdateUserStatusDto'];
export type UpdateUserRoleRequest = components['schemas']['UpdateUserRoleDto'];
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

// 知识库：契约类型来自后端 Swagger 生成的 components.schemas。
// 后端已改用允许式契约 KnowledgeBaseItemDto（不再拿实体当契约），
// 字段集在所有端点一致，likeCount/isLiked 因此是必填而非可选。
export type KnowledgeBase = components['schemas']['KnowledgeBaseItemDto'];
export type KnowledgeBaseVisibility = KnowledgeBase['visibility'];
export type CreateKnowledgeBaseRequest =
  components['schemas']['CreateKnowledgeBaseDto'];
export type UpdateKnowledgeBaseRequest =
  components['schemas']['UpdateKnowledgeBaseDto'];

// KnowledgeDocument：详情/上传响应契约（KnowledgeDocumentDetailDto），
// 由后端 @ApiResponse({ type }) 生成——含解析全文 content；列表项见下面的 ListItem。
export type KnowledgeDocument =
  components['schemas']['KnowledgeDocumentDetailDto'];

// KnowledgeDocumentListItem：文档**列表项**契约（KnowledgeDocumentListItemDto），
// 刻意不含解析全文 content——列表接口做列投影，content 只由详情接口返回
export type KnowledgeDocumentListItem =
  components['schemas']['KnowledgeDocumentListItemDto'];
