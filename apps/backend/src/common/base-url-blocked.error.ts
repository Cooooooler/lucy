import { BadRequestException } from '@nestjs/common';

/**
 * Base URL 指向受限地址（链路本地/云元数据）或被拒跟随重定向。
 *
 * 继承 `BadRequestException`：在 API 边界（保存模型配置）直接是 400；在传输层
 * （连接测试/对话/embedding）被 OpenAI/Anthropic SDK 包成 `APIConnectionError`
 * （原错误挂在 `cause` 上），由 `provider-error` 的 cause 链提取文案。
 *
 * 放在 `common/` 让该提取逻辑不依赖 model-provider 模块。
 */
export class BaseUrlBlockedError extends BadRequestException {
  constructor(message: string) {
    super(message);
    this.name = 'BaseUrlBlockedError';
  }
}
