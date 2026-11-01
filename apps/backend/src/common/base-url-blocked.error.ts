import { BadRequestException } from '@nestjs/common';

/**
 * Base URL 出站守卫错误的基类。
 *
 * 继承 `BadRequestException`：在 API 边界（保存模型配置）直接是 400；在传输层
 * （连接测试/对话/embedding）被 OpenAI/Anthropic SDK 包成 `APIConnectionError`
 * （原错误挂在 `cause` 上），由 `provider-error` 的 cause 链提取文案。
 *
 * 放在 `common/` 让该提取逻辑不依赖 model-provider 模块。
 */
export class BaseUrlGuardError extends BadRequestException {
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
