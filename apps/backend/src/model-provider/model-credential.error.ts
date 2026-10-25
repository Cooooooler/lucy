/**
 * 模型凭证错误：与供应商无关的**服务端凭证**问题，连接测试与对话链路都要把它单独归因
 * 给用户，而不是落进「连接失败/生成失败」——真实原因在平台或服务端状态，用户改 provider
 * 的地址/类型都无济于事。
 * - `decrypt-failed`：`MODEL_PROVIDER_SECRET_KEY` 已轮换或密文损坏，重新保存 API Key 即恢复；
 * - `missing`：构建客户端需要 Key 但库里没有（正常经 DTO/服务层校验不应发生，
 *   撞到它说明数据或装配被打过补丁）。
 *
 * `options` 透传给 `Error`：调用方保留原始解密错误在 `cause` 与栈上，便于排查根因。
 */
export class ModelCredentialError extends Error {
  constructor(
    readonly reason: 'decrypt-failed' | 'missing',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModelCredentialError';
  }
}
