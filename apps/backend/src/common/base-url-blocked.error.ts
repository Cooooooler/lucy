/**
 * Base URL 出站守卫错误的基类（纯领域错误，不携带 HTTP 语义）。
 *
 * 出站层（undici fetch / DNS lookup / tokenizer）与协议无关，只有 API 边界
 * （保存模型配置）才需要 400——由 `ModelProviderService` 显式映射。
 * 传输层被 SDK 包成 `APIConnectionError` 后，`provider-error` 沿 `cause` 链提取文案。
 */
export class BaseUrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 主机（字面量或解析结果）落在链路本地/云元数据地址 */
export class BaseUrlBlockedError extends BaseUrlGuardError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * 云端供应商把 Base URL 指向私网/回环地址。
 *
 * 继承 `BaseUrlBlockedError`：两者同属「地址策略拒绝」，连接测试/对话链路的文案提取
 * （`blockedErrorMessage`）与 `instanceof` 兜底无需新增分支；消息分开只为让用户
 * 知道该改地址，而不是去反复怀疑供应商故障或 API Key。
 */
export class BaseUrlPrivateAddressError extends BaseUrlBlockedError {
  constructor() {
    super(
      'API Base URL 指向私网/回环地址；云端供应商（OpenAI/Anthropic）不允许，请改用公网地址或选择 ollama',
    );
  }
}

/** 目标返回重定向；为防 302 指向元数据端点而拒绝跟随（与「地址受限」分开归因） */
export class BaseUrlRedirectError extends BaseUrlGuardError {
  constructor() {
    super('API Base URL 返回重定向，已拒绝跟随（请直接配置最终地址）');
  }
}
