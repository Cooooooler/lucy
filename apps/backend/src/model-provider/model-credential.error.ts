/**
 * 模型凭证错误：与供应商无关的**服务端凭证**问题，连接测试与对话链路都要把它单独归因
 * 给用户，而不是落进「连接失败/生成失败」——真实原因在平台或服务端状态，用户改 provider
 * 的地址/类型都无济于事。
 * - `decrypt-failed`：`MODEL_PROVIDER_SECRET_KEY` 已轮换或密文损坏，重新保存 API Key 即恢复；
 * - `missing`：构建客户端需要 Key 但库里没有（正常经 DTO/服务层校验不应发生，
 *   撞到它说明数据或装配被打过补丁）。
 *
 * `options` 透传给 `Error`：调用方保留原始解密错误在 `cause` 与栈上，便于排查根因。
 * 文案只有一个消费口径（错误上挂 `userMessage`），新增 reason 时 switch 穷尽校验会在
 * 编译期报错——不允许隐式 else 兜出错误文案。SSE error 帧的 code 用
 * `ErrorCode.AI_CREDENTIAL_INVALID`：前端按未知码回退 `event.data.message`，
 * 该 code 不得进入 use-chat 的 SSE_ERROR_TEXT 映射表（理由见错误码注释）。
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

  /** 按失败原因给用户可执行的恢复提示（供连接测试与 SSE error 帧共用） */
  get userMessage(): string {
    switch (this.reason) {
      case 'decrypt-failed':
        return '平台密钥已变更，请重新保存 API Key';
      case 'missing':
        return '该模型未配置 API Key，请保存后重试';
      default: {
        // 穷尽校验：新增 reason 而未补文案时，编译期在这里报错而不是静默漏归因
        const exhaust: never = this.reason;
        return exhaust;
      }
    }
  }
}
