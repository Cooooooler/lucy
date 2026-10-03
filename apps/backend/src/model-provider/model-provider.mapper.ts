import { maskApiKey } from './api-key-cipher.js';
import type { ModelProviderItemDto } from './dto/model-provider-list-result.dto.js';
import type { ModelProvider } from './entities/model-provider.entity.js';

/**
 * 把模型供应商实体映射为对外契约视图（允许式白名单）。
 *
 * 只输出脱敏后的 `apiKeyMasked`（由落库的尾号生成）——明文与密文都不在返回里。
 */
export function toModelProviderItem(
  provider: ModelProvider,
): ModelProviderItemDto {
  const {
    id,
    ownerId,
    name,
    type,
    vendor,
    baseUrl,
    protocol,
    contextLength,
    apiKeyLast4,
    createdAt,
    updatedAt,
  } = provider;
  return {
    id,
    ownerId,
    name,
    type,
    vendor,
    baseUrl,
    protocol,
    contextLength,
    apiKeyMasked: maskApiKey(apiKeyLast4),
    createdAt,
    updatedAt,
  };
}
