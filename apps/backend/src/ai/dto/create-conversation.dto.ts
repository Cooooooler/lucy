/**
 * 创建会话请求体：当前无可选字段（会话的默认模型在首条消息发送时由所选模型写入），
 * 保留空 DTO 作为 `@Body()` 的契约占位，避免控制器直接收 `unknown`。
 */
export class CreateConversationDto {}
