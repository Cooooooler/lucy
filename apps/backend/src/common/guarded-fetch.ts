import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { BaseUrlRedirectError } from './base-url-blocked.error.js';
import {
  assertBaseUrlHostAllowed,
  resolveAllowedAddresses,
} from './base-url-guard.js';

/** 取 fetch 入参的 URL 字符串（支持 string / URL / Request） */
function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * undici 的 connect lookup：用**已校验的解析结果**建立连接。
 *
 * 这是防 DNS rebinding 的关键：全局 fetch 会「校验时解析一次、连接时再解析一次」，
 * TTL=0 的域名可以在第一次返回公网 IP、第二次返回 169.254.169.254。这里把解析、
 * 校验、连接合成一次 lookup，连接直接用校验过的地址。
 *
 * keep-alive 复用连接时不会重复 lookup，因此不会给每个请求增加一次 DNS 查询；
 * 新连接才解析，且受 undici 的连接超时/请求 signal 约束。
 */
function createGuardedLookup(): LookupFunction {
  return (hostname, options, callback) => {
    resolveAllowedAddresses(hostname)
      .then((addresses) => {
        if (options?.all) {
          callback(null, addresses);
          return;
        }
        const [first] = addresses;
        callback(null, first.address, first.family);
      })
      .catch((error: unknown) => callback(error as Error, '', 0));
  };
}

/** 带关闭钩子的 fetch：Agent 是连接池资源，停机时必须显式关闭 */
export interface GuardedFetch {
  fetch: typeof fetch;
  /** 优雅关闭：等待在途请求结束（可能被卡住的请求拖住） */
  close(): Promise<void>;
  /** 强制销毁：中止在途请求并关闭连接（停机宽限到期时使用） */
  destroy(): Promise<void>;
}

/** 连接池参数（缺省走 undici 默认值；由 OUTBOUND_* 环境变量解析后传入） */
export interface GuardedFetchOptions {
  maxConnections?: number;
  connectTimeoutMs?: number;
}

/**
 * 模型客户端（连接测试与真实对话）统一使用的 fetch：
 *
 * 1. 主机字面量先做同步校验（IP 字面量、已知元数据主机名）；
 * 2. 通过 undici `Agent` 的 `connect.lookup` 按**解析后的 IP** 校验并把地址钉给连接；
 * 3. `redirect: 'manual'`：不跟随重定向，避免 302 指向元数据端点；
 *    3xx 先释放响应体再抛可读错误（不读 body 时连接不会归还连接池）。
 *
 * 以函数形式注入各 SDK 的 `fetch` 选项（OpenAI/Anthropic/Ollama 均支持）。
 */
export function createGuardedFetch(
  options: GuardedFetchOptions = {},
): GuardedFetch {
  const dispatcher = new Agent({
    ...(options.maxConnections ? { connections: options.maxConnections } : {}),
    connect: {
      lookup: createGuardedLookup(),
      ...(options.connectTimeoutMs
        ? { timeout: options.connectTimeoutMs }
        : {}),
    },
  });
  const guardedFetch: typeof fetch = async (input, init) => {
    assertBaseUrlHostAllowed(requestUrlOf(input));
    const response = await undiciFetch(
      input as never,
      {
        ...init,
        redirect: 'manual',
        dispatcher,
      } as never,
    );
    if (response.status >= 300 && response.status < 400) {
      // 不消费 body 时 keep-alive 连接不会归还，重复失败会累积占用连接
      await response.body?.cancel().catch(() => {});
      throw new BaseUrlRedirectError();
    }
    return response as unknown as Response;
  };
  return {
    fetch: guardedFetch,
    close: () => dispatcher.close(),
    destroy: () => dispatcher.destroy(),
  };
}
