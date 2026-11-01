import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/** IPv4 链路本地 169.254.0.0/16（含云元数据 169.254.169.254） */
const isLinkLocalV4 = (host: string): boolean => host.startsWith('169.254.');

/** 把两个十六进制 hextet 还原成点分 IPv4（IPv6 里的内嵌 IPv4 都是这个形式） */
function ipv4FromHextets(hiHex: string, loHex: string): string {
  const hi = Number.parseInt(hiHex, 16);
  const lo = Number.parseInt(loHex, 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * IPv6 受限地址判定：链路本地 fe80::/10、AWS 元数据 fd00:ec2::/64，
 * 以及所有「内嵌 IPv4」的封装形式——只检查外层 IPv6 字面量会被绕过：
 * - IPv4 映射 ::ffff:a9fe:a9fe / IPv4 兼容 ::a9fe:a9fe
 * - 6to4 2002:<v4hi>:<v4lo>::/48
 * - Teredo 2001:0:<服务器 v4hi>:<服务器 v4lo>:...（bits 32–63 是服务器 IPv4）
 * - NAT64 64:ff9b::<v4hi>:<v4lo>
 */
function isBlockedV6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10
  if (h.startsWith('fd00:ec2:')) return true; // AWS IMDS IPv6
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) return isLinkLocalV4(ipv4FromHextets(mapped[1], mapped[2]));
  const compat = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (compat) return isLinkLocalV4(ipv4FromHextets(compat[1], compat[2]));
  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (nat64) return isLinkLocalV4(ipv4FromHextets(nat64[1], nat64[2]));
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/.exec(h);
  if (sixToFour) {
    return isLinkLocalV4(ipv4FromHextets(sixToFour[1], sixToFour[2]));
  }
  const teredo = /^2001:0:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(h);
  if (teredo) return isLinkLocalV4(ipv4FromHextets(teredo[1], teredo[2]));
  return false;
}

/** 单个 IP（v4/v6 字面量）是否落在受限范围 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isLinkLocalV4(address);
  if (version === 6) return isBlockedV6(address);
  return false;
}

/** 主机字面量（域名或 IP）是否命中受限地址；不做 DNS 解析 */
function isBlockedHostLiteral(host: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(host) || isLinkLocalV4(host) || isBlockedV6(host)
  );
}

function throwBlocked(): never {
  throw new BadRequestException(
    'API Base URL 指向受限地址（链路本地/云元数据），请检查主机',
  );
}

/**
 * 校验 baseUrl 的**主机字面量**不落在链路本地/云元数据地址上（同步、无 DNS）。
 *
 * 写入模型配置时先做这一层快速失败；真正的连接侧校验见
 * `assertBaseUrlResolvedAllowed`（解析后的 IP）与 `createGuardedFetch`（每一跳请求）。
 *
 * 私网与回环**刻意放行**——本地 Ollama 常在 localhost/LAN。IPv4 用 WHATWG URL 归一化，
 * 十进制/十六进制/八进制写法（如 `http://2852039166/`）都会被还原成点分地址，无法绕过。
 *
 * @throws BadRequestException 主机命中受限地址
 */
export function assertBaseUrlHostAllowed(baseUrl: string): void {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (isBlockedHostLiteral(host)) throwBlocked();
}

/**
 * 校验 baseUrl 在**解析之后**不落在受限地址上（连接前调用）。
 *
 * 字面量校验拦不住 `http://attacker.example`（A 记录指向 169.254.169.254）：
 * 这里对域名做一次 DNS 解析并逐个检查返回的地址（IPv4/IPv6 全部，含内嵌 IPv4 的
 * IPv6 封装形式）。DNS 解析失败原样抛出（那是网络错误，由调用方按「连不上」归因）；
 * 命中受限地址则抛 `BadRequestException`。
 *
 * 注意 DNS 与真实连接之间存在 TOCTOU 窗口：本函数的定位是「连接前的显式拒绝」，
 * 真正的逐请求不变量由 `createGuardedFetch` 在每次出站请求前再校验一次。
 *
 * @throws BadRequestException 任一解析结果命中受限地址
 */
export async function assertBaseUrlResolvedAllowed(
  baseUrl: string,
): Promise<void> {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (isBlockedHostLiteral(host)) throwBlocked();
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return; // 字面量已在上一步校验，无需解析
  const addresses = await lookup(bare, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throwBlocked();
  }
}
