import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  BaseUrlBlockedError,
  BaseUrlPrivateAddressError,
} from './base-url-blocked.error.js';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

const BLOCKED_MESSAGE =
  'API Base URL 指向受限地址（链路本地/云元数据），请检查主机';

/**
 * 出站地址策略：同一个守卫服务两种使用场景。
 *
 * - 本地模型（Ollama）与 tokenizer 必须能连 localhost/LAN，`allowPrivateHosts: true`；
 * - 云端供应商（OpenAI/Anthropic）是认证用户可自由填写的出口，只许公网，
 *   `allowPrivateHosts: false`，否则可把 baseUrl 指向 127.0.0.1、内网管理接口。
 *
 * `allowedPrivateHosts` 是运维侧的显式白名单：内网自建网关（vLLM / LM Studio 等）
 * 用 OpenAI 兼容协议部署在 10.x/192.168.x 时，按**配置里书写的主机名或 IP 字面量**
 * 放行。它只解除「私网/回环」限制，链路本地/云元数据始终拦截。
 *
 * ⚠️ 白名单按主机名匹配、不含端口：放行 `vllm.lan` 等于放行该主机的所有端口
 * （undici lookup 只拿到主机名，连接期无法按 host:port 判定）。
 */
export interface BaseUrlPolicy {
  /** 是否允许私网、回环及其它非公网地址 */
  allowPrivateHosts: boolean;
  /** 显式放行私网的主机（小写主机名或 IP 字面量，不含协议/端口） */
  allowedPrivateHosts?: ReadonlySet<string>;
}

/** IPv4 链路本地 169.254.0.0/16（含云元数据 169.254.169.254） */
const isLinkLocalV4 = (host: string): boolean => host.startsWith('169.254.');

/** 阿里云 ECS 元数据 100.100.100.200（不在链路本地段，需单独拦；只匹配精确 IP） */
const isAliyunMetadataV4 = (host: string): boolean =>
  host === '100.100.100.200';

/** IPv4 受限地址：链路本地 + 云元数据精确端点 */
const isBlockedV4 = (host: string): boolean =>
  isLinkLocalV4(host) || isAliyunMetadataV4(host);

/**
 * IPv4 非公网地址：私网、回环、CGNAT、未指定、链路本地、基准测试、文档/协议
 * 保留段与组播/保留段。
 *
 * 云端供应商的 baseUrl 指向这些地址等同于「拿服务端身份去探测内网」，
 * 因此默认拒绝；本地 Ollama 场景由策略整体豁免。
 */
function isPrivateV4(host: string): boolean {
  const [a, b, c] = host.split('.').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (
    a === 0 || // 0.0.0.0/8 本网络
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 回环
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 链路本地
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF 协议分配
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 中继（已废弃）
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 基准测试
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 TEST-NET-3
    a >= 224 // 组播(224/4) / 保留(240/4) / 广播
  );
}

/** DNS 解析得到的地址（family 收窄为 4/6，供连接期 lookup 原样回传） */
export interface ResolvedHostAddress {
  address: string;
  family: 4 | 6;
}

/**
 * IPv6 字面量 → 16 字节。支持 `::` 压缩与尾部点分内嵌 IPv4
 * （`::ffff:169.254.169.254`、`64:ff9b::169.254.169.254` 等）。
 *
 * 不对字符串做正则匹配：`isIP()` 接受的点分内嵌形式不会匹配十六进制 hextet 正则，
 * 只按字符形态判断会被绕过；统一转成字节后按位判断。
 */
function ipv6ToBytes(input: string): number[] | null {
  let text = input
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .toLowerCase();
  // 尾部点分 IPv4 → 两个 hextet，再按普通 IPv6 解析
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n < 0 || n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, v4.index)}${hi}:${lo}`;
  }
  const compressed = text.includes('::');
  const [head = '', tail = ''] = compressed
    ? (text.split('::') as [string, string])
    : [text, ''];
  const headParts = head ? head.split(':') : [];
  const tailParts = compressed && tail ? tail.split(':') : [];
  const missing =
    8 - headParts.filter((part) => part !== '').length - tailParts.length;
  if (missing < 0 || (!compressed && headParts.length !== 8)) return null;
  const parts = [
    ...headParts.filter((part) => part !== ''),
    ...Array<string>(missing).fill('0'),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 16);
    if (!/^[0-9a-f]{1,4}$/.test(part) || Number.isNaN(value)) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

/** IPv4 四字节 → 点分地址 */
const v4At = (bytes: number[], index: number): string =>
  bytes.slice(index, index + 4).join('.');

const allZero = (bytes: number[], from: number, to: number): boolean =>
  bytes.slice(from, to).every((byte) => byte === 0);

/**
 * IPv6 字节里的内嵌 IPv4（各种封装形式），无内嵌时返回 null。
 *
 * 只检查外层 IPv6 字面量会被绕过，内嵌形式统一还原成 IPv4 再判定：
 * - IPv4 映射 ::ffff:a.b.c.d（含 ::ffff:0:a.b.c.d）
 * - IPv4 兼容 ::a.b.c.d
 * - 6to4 2002::/16（bytes 2–5 是内嵌 IPv4）
 * - Teredo 2001:0000::/32（bytes 4–7 是服务器 IPv4）
 * - NAT64 64:ff9b::/96
 */
function embeddedV4(bytes: number[]): string | null {
  // ::ffff:a.b.c.d
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return v4At(bytes, 12);
  }
  // ::ffff:0:a.b.c.d（IPv4-translated）
  if (allZero(bytes, 0, 8) && bytes[8] === 0xff && bytes[9] === 0xff) {
    return v4At(bytes, 12);
  }
  // ::a.b.c.d（IPv4 兼容，已废弃）
  if (allZero(bytes, 0, 12)) return v4At(bytes, 12);
  // 6to4 2002:V4HI:V4LO::/48
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4At(bytes, 2);
  // Teredo 2001:0000:<服务器 IPv4>:...
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return v4At(bytes, 4);
  }
  // NAT64 64:ff9b::a.b.c.d
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    allZero(bytes, 4, 12)
  ) {
    return v4At(bytes, 12);
  }
  // RFC 8215 本地用 NAT64 64:ff9b:1::/48（同样取最后 32 位还原 IPv4）
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x01
  ) {
    return v4At(bytes, 12);
  }
  return null;
}

/**
 * IPv6 受限地址判定：链路本地 fe80::/10、AWS 元数据 fd00:ec2::/64，
 * 以及所有内嵌 IPv4 的封装形式（见 {@link embeddedV4}）。
 */
function isBlockedV6(input: string): boolean {
  const b = ipv6ToBytes(input);
  if (!b) return false;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xfd && b[1] === 0x00 && b[2] === 0x0e && b[3] === 0xc2) {
    return true; // AWS IMDS IPv6 fd00:ec2::/64
  }
  const v4 = embeddedV4(b);
  return v4 !== null && isBlockedV4(v4);
}

/**
 * IPv6 非公网地址：未指定 `::`、回环 `::1`、唯一本地 fc00::/7、
 * 链路本地 fe80::/10、组播 ff00::/8，以及内嵌 IPv4 的私网形式（`::ffff:127.0.0.1` 等）。
 */
function isPrivateV6(input: string): boolean {
  const b = ipv6ToBytes(input);
  if (!b) return false;
  if (b.every((byte) => byte === 0)) return true; // ::
  if (allZero(b, 0, 15) && b[15] === 1) return true; // ::1
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xff) return true; // ff00::/8 组播（对齐 IPv4 的 a >= 224）
  const v4 = embeddedV4(b);
  return v4 !== null && isPrivateV4(v4);
}

/** 单个 IP（v4/v6 字面量）是否落在受限范围 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return false;
}

/** 单个 IP（v4/v6 字面量）是否非公网（私网/回环/保留/内嵌 IPv4 的封装形式） */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return false;
}

/**
 * 主机名/字面量归一化：去方括号与 zone、去 FQDN 尾点、小写。
 *
 * WHATWG URL 保留尾点（`http://localhost./` 的 hostname 是 `localhost.`），不归一化会
 * 让保存期校验与白名单匹配漏掉这种等价写法（连接期仍会被解析结果拦下，但已晚一步）。
 * 启动期配置校验也复用它，避免两处推导漂移。
 */
export function normalizeHost(host: string): string {
  return host
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * 白名单条目归一化：与运行期 `URL.hostname` 同形。
 *
 * WHATWG 会把 IPv6 改写成规范形式（`0:0:0:0:0:0:0:1` → `::1`、
 * `[::ffff:192.168.1.20]` → `::ffff:c0a8:114`）：不做这一步，启动期校验通过、
 * 运行期白名单却永不匹配。IPv4 与非 IP 主机名走普通归一化。
 */
export function normalizeAllowlistHost(entry: string): string {
  const bare = entry.replace(/^\[|\]$/g, '');
  if (isIP(bare) === 6) {
    try {
      return normalizeHost(new URL(`http://[${bare}]/`).hostname);
    } catch {
      // 非法 IPv6 交回普通归一化，由启动期格式校验报错
    }
  }
  return normalizeHost(entry);
}

/**
 * 解析 `OUTBOUND_ALLOW_PRIVATE_HOSTS`：逗号分隔的主机名或 IP 字面量。
 * 容忍空串与多余空白；空条目直接丢弃（运维配置项不该让启动失败）。
 */
export function parsePrivateHostAllowlist(raw: unknown): ReadonlySet<string> {
  const hosts = new Set<string>();
  if (typeof raw !== 'string') return hosts;
  for (const entry of raw.split(',')) {
    const host = normalizeAllowlistHost(entry.trim());
    if (host) hosts.add(host);
  }
  return hosts;
}

/** baseUrl 主机是否命中显式私网白名单（保存路径据此写审计日志） */
export function isAllowlistedHost(
  baseUrl: string,
  allowedHosts?: ReadonlySet<string>,
): boolean {
  if (!allowedHosts || allowedHosts.size === 0) return false;
  return allowedHosts.has(normalizeHost(new URL(baseUrl).hostname));
}

/**
 * 解析结果本身是否在显式白名单里。
 *
 * 运维按 IP 放行、用户按域名填写（`http://vllm.lan` → 192.168.1.20）时，
 * 仅比对请求主机名会漏掉，连接期就被判私网拒绝；这里按解析地址再匹配一次。
 */
function isAllowlistedAddress(
  address: string,
  allowedHosts?: ReadonlySet<string>,
): boolean {
  return allowedHosts?.has(normalizeAllowlistHost(address)) ?? false;
}

function throwBaseUrlBlocked(): never {
  throw new BaseUrlBlockedError(BLOCKED_MESSAGE);
}

function throwPrivateAddressBlocked(): never {
  throw new BaseUrlPrivateAddressError();
}

/** 主机字面量（域名或 IP）是否命中受限地址；不做 DNS 解析（导出供启动期配置校验复用） */
export function isBlockedHost(host: string): boolean {
  // 域名不做前缀判断：`169.254.cdn.example.com` 是合法域名，不能因前缀被误判；
  // 只有 isIP 认可的 IPv4/IPv6 字面量才进入地址判定（先归一化，尾点/IPv6 方括号都去掉）
  const bare = normalizeHost(host);
  return BLOCKED_HOSTNAMES.has(bare) || isBlockedAddress(bare);
}

/** 私网/回环是否被当前策略放行（策略整体放行或显式白名单） */
function privateHostAllowed(host: string, policy: BaseUrlPolicy): boolean {
  return (
    policy.allowPrivateHosts ||
    (policy.allowedPrivateHosts?.has(normalizeHost(host)) ?? false)
  );
}

/**
 * `localhost` / `*.localhost` 按 RFC 6761 应解析到回环。
 *
 * 保存校验是同步、不做 DNS 的，只靠 IP 字面量判定会漏掉这个最常见写法；
 * 这里按保留用途直接归为私网（连接期 lookup 也会再拦一次）。
 */
function isLoopbackHostname(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
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
 * 私网与回环是否放行由 `policy` 决定（见 {@link BaseUrlPolicy}）：本地 Ollama 必须能连
 * localhost/LAN，云端供应商默认只许公网。IPv4 用 WHATWG URL 归一化，十进制/十六进制/
 * 八进制写法（如 `http://2852039166/`）都会被还原成点分地址，无法绕过。
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
 * 私网/回环即抛 `BaseUrlPrivateAddressError`（白名单按**请求的主机名/字面量**匹配）。
 * 解析失败原样抛出（按网络错误归因）。
 *
 * @throws BaseUrlBlockedError 任一解析结果命中受限地址
 * @throws BaseUrlPrivateAddressError 策略不允许私网且任一解析结果为私网/回环
 */
export async function resolveAllowedAddresses(
  hostname: string,
  policy: BaseUrlPolicy,
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
    if (
      !allowPrivate &&
      !isAllowlistedAddress(address, policy.allowedPrivateHosts) &&
      isPrivateAddress(address)
    ) {
      throwPrivateAddressBlocked();
    }
  }
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}
