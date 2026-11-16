import type { BaseUrlPolicy } from '../common/base-url-guard.js';
import { ModelProviderVendor } from './entities/model-provider.entity.js';

/**
 * 供应商是否允许 baseUrl 指向私网/回环。
 *
 * 只有本地部署的 Ollama 默认放行（localhost / LAN 是常态）；OpenAI / Anthropic 是
 * 云端托管服务，把 baseUrl 指向内网等同于「拿服务端身份探测内网」，默认拒绝。
 *
 * 保存校验（`ModelProviderService`）与连接期（`GuardedFetchService` 的两个连接池，
 * 由 `ModelClientFactory` 按 vendor 选择）都从这里取判据，两处策略不会漂移。
 */
export function vendorAllowsPrivateHosts(vendor: ModelProviderVendor): boolean {
  return vendor === ModelProviderVendor.Ollama;
}

/**
 * 组合出某 vendor 的地址策略：`OUTBOUND_ALLOW_PRIVATE_HOSTS` 只对默认拒绝的
 * 云端 vendor 有意义（Ollama 本来就整体放行）。
 */
export function vendorBaseUrlPolicy(
  vendor: ModelProviderVendor,
  allowedPrivateHosts: ReadonlySet<string>,
): BaseUrlPolicy {
  return {
    allowPrivateHosts: vendorAllowsPrivateHosts(vendor),
    allowedPrivateHosts,
  };
}
