import { classifyHostname, type BaseUrlHostKind } from '@lucy/shared';

/**
 * Base URL 主机分类（前端快速反馈用，网段判定与后端共享同一实现）。
 *
 * 后端才是权威：所有供应商（含 ollama）默认拒绝私网/回环，运维可经
 * `OUTBOUND_ALLOW_PRIVATE_HOSTS` 放行；链路本地/云元数据任何策略下都拒绝。
 * 前端拿不到服务端白名单，所以：
 * - `blocked` → 硬错误（后端一定拒绝，提交没有意义）
 * - `private` → 只给**警告**，让白名单里的内网/本地部署仍可提交，最终由后端裁决
 */

export type { BaseUrlHostKind };

export const BLOCKED_BASE_URL_MESSAGE =
  '该地址属于链路本地/云元数据地址，不能作为 API Base URL';

export const PRIVATE_BASE_URL_MESSAGE =
  '私网/回环地址需由服务端显式放行，否则无法保存';

/** 上一次分类结果：两条表单规则（硬错误/警告）会对同一次输入各调一次，避免重复解析 */
let lastInput: string | null = null;
let lastKind: BaseUrlHostKind | null = null;

/** 无法解析为 URL 时返回 null（交给表单的 url 规则报错） */
export function classifyBaseUrlHost(baseUrl: string): BaseUrlHostKind | null {
  if (baseUrl === lastInput) return lastKind;
  lastKind = classifyUncached(baseUrl);
  lastInput = baseUrl;
  return lastKind;
}

function classifyUncached(baseUrl: string): BaseUrlHostKind | null {
  let host: string;
  try {
    host = new URL(baseUrl.trim()).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  return classifyHostname(host);
}
