import { BadRequestException } from '@nestjs/common';
import { assertBaseUrlResolvedAllowed } from './base-url-guard.js';

/** 取 fetch 入参的 URL 字符串（支持 string / URL / Request） */
function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * 模型客户端（连接测试与真实对话）统一使用的 fetch：
 *
 * 1. 每次出站请求前按**解析后的 IP** 再校验一次（防 DNS 名指向链路本地/云元数据，
 *    也把 TOCTOU 窗口压缩到「解析 → 立即请求」）；
 * 2. `redirect: 'manual'`：不跟随重定向，避免 302 指向元数据端点；
 *    3xx 直接抛可读错误（API Base URL 正常不应依赖重定向）。
 *
 * 以函数形式注入各 SDK 的 `fetch` 选项（OpenAI/Anthropic/Ollama 均支持），
 * 而不是依赖它们各自的默认 fetch——默认实现会自动跟随重定向。
 */
export function createGuardedFetch(): typeof fetch {
  return async (input, init) => {
    await assertBaseUrlResolvedAllowed(requestUrlOf(input));
    const response = await fetch(input, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      throw new BadRequestException('API Base URL 返回重定向，已拒绝跟随');
    }
    return response;
  };
}
