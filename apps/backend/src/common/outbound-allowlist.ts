import { isIP } from 'node:net';
import {
  isBlockedHost,
  isLoopbackHostname,
  LOOPBACK_HOSTS,
  normalizeHost,
} from './ip-address.js';

/**
 * 出站私网白名单（`OUTBOUND_ALLOW_PRIVATE_HOSTS`）：
 * 条目归一化、格式校验、解析，以及保存/连接两处共用的匹配判据。
 *
 * 纯函数模块，只依赖 `node:net`：启动期配置校验可以直接 import 它，
 * 不会连带加载 DNS 或出站守卫实现。
 */

/** 已解析的私网白名单（`OUTBOUND_ALLOW_PRIVATE_HOSTS`） */
export const OUTBOUND_PRIVATE_HOST_ALLOWLIST = Symbol(
  'OUTBOUND_PRIVATE_HOST_ALLOWLIST',
);

/**
 * 白名单条目归一化：与运行期 `URL.hostname` 同形。
 *
 * WHATWG 不只改写 IPv6（`0:0:0:0:0:0:0:1` → `::1`、
 * `[::ffff:192.168.1.20]` → `::ffff:c0a8:114`），也会把数字点数写法改写成点分 IPv4
 * （`0x7f.1` → `127.0.0.1`、`192.168.1.010` → `192.168.1.8`）。不做这一步，
 * 启动期校验通过、运行期白名单却永不匹配。
 */
export function normalizeAllowlistHost(entry: string): string {
  const text = entry.trim();
  if (!text) return '';
  const bracketed =
    text.includes(':') && !text.startsWith('[') ? `[${text}]` : text;
  try {
    return normalizeHost(new URL(`http://${bracketed}/`).hostname);
  } catch {
    // 非法条目交回普通归一化，由启动期格式校验报错
    return normalizeHost(text);
  }
}

/** 白名单条目：主机名 / IPv4 / IPv6（IPv6 可带方括号），不含协议、端口与路径 */
const ALLOWLIST_HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
/** 纯数字/点号：URL 归一化会改变形态（192.168.1.010 → 192.168.1.8），必须自身是合法 IP */
const NUMERIC_HOST_RE = /^[0-9.]+$/;

/**
 * 白名单条目是否可用（启动期 Joi 校验与运行期解析共用这一处判据）。
 *
 * 先做锚定形态校验再按 URL 归一化比对：主机名不含路径/查询/userinfo，冒号只允许
 * 出现在合法 IPv6 字面量里；IPv4 必须是规范点分写法（`0x7f.1` 会被 URL 改写成
 * `127.0.0.1`，存下来与运行期主机名对不上）。
 */
export function isValidAllowlistHost(entry: string): boolean {
  const raw = entry.trim();
  if (!raw) return false;
  const bare = raw.replace(/^\[|\]$/g, '');
  const isIpv6 = isIP(bare) === 6;
  if (/[/?#@]/.test(raw)) return false;
  if (raw.includes(':') && !isIpv6) return false;

  const host = normalizeAllowlistHost(raw);
  if (isBlockedHost(host)) return false;
  // 未指定地址（0.0.0.0 / ::）在 Linux 上会被路由到本机回环，放行它等于放行本机任意端口
  if (host === '0.0.0.0' || host === '::') return false;
  if (isIP(host) !== 0) return isIpv6 || bare.toLowerCase() === host;
  if (NUMERIC_HOST_RE.test(host)) return false;
  return ALLOWLIST_HOSTNAME_RE.test(host);
}

/**
 * 解析 `OUTBOUND_ALLOW_PRIVATE_HOSTS`：逗号分隔的主机名或 IP 字面量。
 * 容忍空串与多余空白；非法条目直接丢弃（生产路径已由启动期 Joi 校验拦下，
 * 这里兜住脚本/测试等绕过校验的来源，避免「存了但永不匹配」）。
 */
export function parsePrivateHostAllowlist(raw: unknown): ReadonlySet<string> {
  const hosts = new Set<string>();
  if (typeof raw !== 'string') return hosts;
  for (const entry of raw.split(',')) {
    if (!entry.trim() || !isValidAllowlistHost(entry)) continue;
    const host = normalizeAllowlistHost(entry.trim());
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * 主机是否在显式白名单里（保存期校验/审计与连接期守卫共用的唯一判据）。
 *
 * `localhost` / `*.localhost` 与保留回环地址等价：白名单写 `127.0.0.1` 时，
 * 用 `localhost` 的配置同样算「因白名单而放行」，否则审计会漏记这类等价写法。
 */
export function isAllowlistedHostMatch(
  host: string,
  allowedHosts?: ReadonlySet<string>,
): boolean {
  if (!allowedHosts || allowedHosts.size === 0) return false;
  const bare = normalizeHost(host);
  const isLoopbackForm =
    isLoopbackHostname(bare) || LOOPBACK_HOSTS.some((item) => item === bare);
  if (isLoopbackForm) {
    return LOOPBACK_HOSTS.some((item) => allowedHosts.has(item));
  }
  return allowedHosts.has(bare);
}

/** baseUrl 主机是否命中显式私网白名单（保存路径据此写审计日志） */
export function isAllowlistedHost(
  baseUrl: string,
  allowedHosts?: ReadonlySet<string>,
): boolean {
  return isAllowlistedHostMatch(new URL(baseUrl).hostname, allowedHosts);
}

/**
 * 解析结果本身是否在显式白名单里。
 *
 * 运维按 IP 放行、用户按域名填写（`http://vllm.lan` → 192.168.1.20）时，
 * 仅比对请求主机名会漏掉，连接期就被判私网拒绝；这里按解析地址再匹配一次。
 */
export function isAllowlistedAddress(
  address: string,
  allowedHosts?: ReadonlySet<string>,
): boolean {
  return allowedHosts?.has(normalizeAllowlistHost(address)) ?? false;
}
