import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BaseUrlBlockedError } from './base-url-blocked.error.js';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

const BLOCKED_MESSAGE =
  'API Base URL 指向受限地址（链路本地/云元数据），请检查主机';

/** IPv4 链路本地 169.254.0.0/16（含云元数据 169.254.169.254） */
const isLinkLocalV4 = (host: string): boolean => host.startsWith('169.254.');

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

/**
 * IPv6 受限地址判定：链路本地 fe80::/10、AWS 元数据 fd00:ec2::/64，
 * 以及所有「内嵌 IPv4」的封装形式——只检查外层 IPv6 字面量会被绕过：
 * - IPv4 映射 ::ffff:a.b.c.d（含 ::ffff:0:a.b.c.d）
 * - IPv4 兼容 ::a.b.c.d
 * - 6to4 2002::/16（bytes 2–5 是内嵌 IPv4）
 * - Teredo 2001:0000::/32（bytes 4–7 是服务器 IPv4）
 * - NAT64 64:ff9b::/96
 */
function isBlockedV6(input: string): boolean {
  const b = ipv6ToBytes(input);
  if (!b) return false;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xfd && b[1] === 0x00 && b[2] === 0x0e && b[3] === 0xc2) {
    return true; // AWS IMDS IPv6 fd00:ec2::/64
  }
  const zero = (from: number, to: number) =>
    b.slice(from, to).every((byte) => byte === 0);
  // ::ffff:a.b.c.d
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isLinkLocalV4(v4At(b, 12));
  }
  // ::ffff:0:a.b.c.d（IPv4-translated）
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff) {
    return isLinkLocalV4(v4At(b, 12));
  }
  // ::a.b.c.d（IPv4 兼容，已废弃；:: 与 ::1 会落到 0.0.0.0 / 0.0.0.1，放行）
  if (zero(0, 12)) return isLinkLocalV4(v4At(b, 12));
  // 6to4 2002:V4HI:V4LO::/48
  if (b[0] === 0x20 && b[1] === 0x02) return isLinkLocalV4(v4At(b, 2));
  // Teredo 2001:0000:<服务器 IPv4>:...
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) {
    return isLinkLocalV4(v4At(b, 4));
  }
  // NAT64 64:ff9b::a.b.c.d
  if (
    b[0] === 0x00 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    zero(4, 12)
  ) {
    return isLinkLocalV4(v4At(b, 12));
  }
  return false;
}

/** 单个 IP（v4/v6 字面量）是否落在受限范围 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isLinkLocalV4(address);
  if (version === 6) return isBlockedV6(address);
  return false;
}

function throwBaseUrlBlocked(): never {
  throw new BaseUrlBlockedError(BLOCKED_MESSAGE);
}

/** 主机字面量（域名或 IP）是否命中受限地址；不做 DNS 解析 */
function isBlockedHostLiteral(host: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(host) || isLinkLocalV4(host) || isBlockedV6(host)
  );
}

/**
 * 校验 baseUrl 的**主机字面量**不落在链路本地/云元数据地址上（同步、无 DNS）。
 *
 * 写入模型配置时先做这一层快速失败；真正的连接期校验在 `createGuardedFetch`
 * 的 undici `lookup` 里：解析、校验并把地址钉给连接。
 *
 * 私网与回环**刻意放行**——本地 Ollama 常在 localhost/LAN。IPv4 用 WHATWG URL 归一化，
 * 十进制/十六进制/八进制写法（如 `http://2852039166/`）都会被还原成点分地址，无法绕过。
 *
 * @throws BaseUrlBlockedError 主机命中受限地址
 */
export function assertBaseUrlHostAllowed(baseUrl: string): void {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (isBlockedHostLiteral(host)) throwBaseUrlBlocked();
}

/**
 * 解析主机并校验**每个**返回地址（IPv4/IPv6 全部，含内嵌 IPv4 的 IPv6 封装形式）。
 *
 * 返回已校验的地址列表，调用方（undici 连接期 lookup）可把其中一个钉给连接，
 * 避免「校验时解析一次、连接时再解析一次」的 DNS rebinding 窗口。
 * 任一地址命中受限范围即抛 `BaseUrlBlockedError`；解析失败原样抛出（按网络错误归因）。
 *
 * @throws BaseUrlBlockedError 任一解析结果命中受限地址
 */
export async function resolveAllowedAddresses(
  hostname: string,
): Promise<ResolvedHostAddress[]> {
  const bare = hostname
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .toLowerCase();
  const literalVersion = isIP(bare);
  if (literalVersion) {
    if (isBlockedAddress(bare)) throwBaseUrlBlocked();
    return [{ address: bare, family: literalVersion as 4 | 6 }];
  }
  const addresses = await lookup(bare, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`DNS 解析为空：${bare}`);
  }
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throwBaseUrlBlocked();
  }
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}
