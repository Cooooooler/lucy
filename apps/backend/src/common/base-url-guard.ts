import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  BaseUrlBlockedError,
  BaseUrlPrivateAddressError,
} from './base-url-blocked.error.js';
import {
  isBlockedAddress,
  isBlockedHost,
  isLoopbackHostname,
  isPrivateAddress,
  LOOPBACK_HOSTS,
  normalizeHost,
} from './ip-address.js';
import { isAllowlistedAddress } from './outbound-allowlist.js';

const BLOCKED_MESSAGE =
  'API Base URL 指向受限地址（链路本地/云元数据），请检查主机';

/**
 * 出站地址策略。
 *
 * 模型供应商的 baseUrl 由认证用户自由填写，任何 vendor（包括 ollama）都不整体放行
 * 私网：只能通过运维侧的 `OUTBOUND_ALLOW_PRIVATE_HOSTS` 显式列出主机名或 IP 字面量。
 * 本地/LAN 的 Ollama 走同一条白名单路径（见 `.env.example`）。
 *
 * `allowedPrivateHosts` 只解除「私网/回环」限制，链路本地/云元数据始终拦截。
 *
 * ⚠️ 白名单按主机名匹配、不含端口：放行 `vllm.lan` 等于放行该主机的所有端口
 * （undici lookup 只拿到主机名，连接期无法按 host:port 判定）。
 */
export interface BaseUrlPolicy {
  /** 是否允许私网、回环及其它非公网地址（进程内受信来源，如服务端配置的 tokenizer 地址） */
  allowPrivateHosts: boolean;
  /** 显式放行私网的主机（小写主机名或 IP 字面量，不含协议/端口） */
  allowedPrivateHosts?: ReadonlySet<string>;
}

/** DNS 解析得到的地址（family 收窄为 4/6，供连接期 lookup 原样回传） */
export interface ResolvedHostAddress {
  address: string;
  family: 4 | 6;
}

function throwBaseUrlBlocked(): never {
  throw new BaseUrlBlockedError(BLOCKED_MESSAGE);
}

function throwPrivateAddressBlocked(): never {
  throw new BaseUrlPrivateAddressError();
}

/**
 * 私网/回环是否被当前策略放行（策略整体放行或显式白名单）。
 *
 * `localhost` / `*.localhost` 与保留回环地址等价：白名单写了 `127.0.0.1` 时，
 * 保存期用 `localhost` 的配置也要放行，否则会出现「保存拒绝、连接放行」的矛盾。
 */
function privateHostAllowed(host: string, policy: BaseUrlPolicy): boolean {
  if (policy.allowPrivateHosts) return true;
  const allowed = policy.allowedPrivateHosts;
  if (!allowed || allowed.size === 0) return false;
  const bare = normalizeHost(host);
  // localhost / *.localhost 与保留回环地址双向等价：任一回环形式在白名单里即放行
  const isLoopbackForm =
    isLoopbackHostname(bare) || LOOPBACK_HOSTS.some((item) => item === bare);
  if (isLoopbackForm) return LOOPBACK_HOSTS.some((item) => allowed.has(item));
  return allowed.has(bare);
}

/** 单个主机（字面量）按策略校验：受限地址永远拒绝，私网/回环由策略决定 */
function assertHostAllowed(host: string, policy: BaseUrlPolicy): void {
  if (isBlockedHost(host)) throwBaseUrlBlocked();
  const bare = normalizeHost(host);
  if (
    !privateHostAllowed(bare, policy) &&
    (isPrivateAddress(bare) || isLoopbackHostname(bare))
  ) {
    throwPrivateAddressBlocked();
  }
}

/**
 * 校验 baseUrl 的**主机字面量**不落在受限/（按策略）私网地址上（同步、无 DNS）。
 *
 * 写入模型配置时先做这一层快速失败；真正的连接期校验在 `createGuardedFetch`
 * 的 undici `lookup` 里：解析、校验并把地址钉给连接。
 *
 * IPv4 用 WHATWG URL 归一化，十进制/十六进制/八进制写法（如 `http://2852039166/`）
 * 都会被还原成点分地址，无法绕过。
 *
 * @throws BaseUrlBlockedError 主机命中受限地址
 * @throws BaseUrlPrivateAddressError 策略不允许私网且主机命中私网/回环
 */
export function assertBaseUrlHostAllowed(
  baseUrl: string,
  policy: BaseUrlPolicy,
): void {
  assertHostAllowed(new URL(baseUrl).hostname.toLowerCase(), policy);
}

/**
 * 解析主机并校验**每个**返回地址（IPv4/IPv6 全部，含内嵌 IPv4 的 IPv6 封装形式）。
 *
 * 返回已校验的地址列表，调用方（undici 连接期 lookup）可把其中一个钉给连接，
 * 避免「校验时解析一次、连接时再解析一次」的 DNS rebinding 窗口。
 * 任一地址命中受限范围即抛 `BaseUrlBlockedError`；策略不允许私网时，任一解析结果为
 * 私网/回环即抛 `BaseUrlPrivateAddressError`（白名单按**请求的主机名/字面量**匹配，
 * 解析出的地址命中白名单也会放行）。
 * 解析失败原样抛出（按网络错误归因）。
 *
 * @param onAllowlistedAddress 靠解析地址命中白名单而放行时的回调（审计用）
 * @throws BaseUrlBlockedError 任一解析结果命中受限地址
 * @throws BaseUrlPrivateAddressError 策略不允许私网且任一解析结果为私网/回环
 */
export async function resolveAllowedAddresses(
  hostname: string,
  policy: BaseUrlPolicy,
  onAllowlistedAddress?: (address: string) => void,
): Promise<ResolvedHostAddress[]> {
  const bare = normalizeHost(hostname);
  const literalVersion = isIP(bare);
  if (literalVersion) {
    assertHostAllowed(bare, policy);
    return [{ address: bare, family: literalVersion as 4 | 6 }];
  }
  const addresses = await lookup(bare, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`DNS 解析为空：${bare}`);
  }
  const allowPrivate = privateHostAllowed(bare, policy);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throwBaseUrlBlocked();
    const allowlisted = isAllowlistedAddress(
      address,
      policy.allowedPrivateHosts,
    );
    if (!allowPrivate && !allowlisted && isPrivateAddress(address)) {
      throwPrivateAddressBlocked();
    }
    // 主机名不在白名单、靠解析地址放行：审计以「实际解除限制的依据」为准
    if (!allowPrivate && allowlisted && isPrivateAddress(address)) {
      onAllowlistedAddress?.(address);
    }
  }
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}
