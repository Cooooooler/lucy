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

/** 目标返回重定向；为防 302 指向元数据端点而拒绝跟随（与「地址受限」分开归因） */
export class BaseUrlRedirectError extends BaseUrlGuardError {
  constructor() {
    super('API Base URL 返回重定向，已拒绝跟随（请直接配置最终地址）');
  }
}
