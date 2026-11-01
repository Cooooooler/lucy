import type { ModelCredentialReason } from '../common/messages.js';

/**
 * 模型凭证错误：与供应商无关的**服务端凭证**问题，连接测试与对话链路都要把它单独归因
 * 给用户，而不是落进「连接失败/生成失败」——真实原因在平台或服务端状态，用户改 provider
 * 的地址/类型都无济于事。
 * - `decrypt-failed`：`MODEL_PROVIDER_SECRET_KEY` 已轮换（GCM 认证失败），重新保存 API Key 即恢复；
 * - `corrupt`：密文封装格式/参数非法（脏数据、被截断），重存 API Key 同样能修复，
 *   但根因不是密钥轮换，提示语不能只写「平台密钥已变更」把排查引偏；
 * - `missing`：构建客户端需要 Key 但库里没有（正常经 DTO/服务层校验不应发生，
 *   撞到它说明数据或装配被打过补丁）。
 *
 * 面向用户的文案不挂在这里，统一放在 `common/messages.ts` 的 `MODEL_CREDENTIAL_MESSAGES`
 * （错误侧文案单源），消费方按 `reason` 查表。
 *
 * `options` 透传给 `Error`：调用方保留原始解密错误在 `cause` 与栈上，失败日志会带出
 * `cause`，便于排查根因。
 *
 * SSE error 帧的 code 用 `ErrorCode.AI_CREDENTIAL_INVALID`：前端按未知码回退
 * `event.data.message`，该 code 不得进入 use-chat 的 SSE_ERROR_TEXT 映射表（理由见错误码注释）。
 */
export class ModelCredentialError extends Error {
  constructor(
    readonly reason: ModelCredentialReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModelCredentialError';
  }
}
