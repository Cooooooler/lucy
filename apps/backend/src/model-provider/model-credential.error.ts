/**
 * 模型凭证错误：与供应商无关的**服务端凭证**问题，连接测试要把它单独归因给用户，
 * 而不是落进「连接失败，请检查配置」——真实原因在平台或服务端状态，用户改 provider
 * 的地址/类型都无济于事。
 * - `decrypt-failed`：`MODEL_PROVIDER_SECRET_KEY` 已轮换或密文损坏，重新保存 API Key 即恢复；
 * - `missing`：构建客户端需要 Key 但库里没有（正常经 DTO/服务层校验不应发生，
 *   撞到它说明数据或装配被打过补丁）。
 */
export class ModelCredentialError extends Error {
  constructor(
    readonly reason: 'decrypt-failed' | 'missing',
    message: string,
  ) {
    super(message);
    this.name = 'ModelCredentialError';
  }
}
