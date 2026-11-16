/**
 * Base URL 主机分类（前端快速反馈用，语义与后端 `common/base-url-guard` 对齐）。
 *
 * 后端才是权威：云端供应商（openai/anthropic）默认拒绝私网/回环，运维可经
 * `OUTBOUND_ALLOW_PRIVATE_HOSTS` 放行；链路本地/云元数据任何策略下都拒绝。
 * 前端拿不到服务端白名单，所以：
 * - `blocked` → 硬错误（后端一定拒绝，提交没有意义）
 * - `private` → 云端 vendor 只给**警告**，让白名单里的内网网关仍可提交，最终由后端裁决
 *
 * 这里只覆盖用户实际会填的常见形态；IPv6 的复杂封装由后端兜底。
 */
export type BaseUrlHostKind = 'public' | 'private' | 'blocked';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

export const BLOCKED_BASE_URL_MESSAGE =
  '该地址属于链路本地/云元数据地址，不能作为 API Base URL';

export const PRIVATE_BASE_URL_MESSAGE =
  '云端供应商不允许私网/回环地址；内网自建网关需由服务端显式放行';

/** 模块级常量：表单每次按键都会走到这里，正则字面量不应在热路径里反复分配 */
const HOST_BRACKETS_RE = /^\[|\]$/g;
const IPV4_OCTET_RE = /^\d{1,3}$/;

/** 主机名/字面量归一化：去方括号与 zone、小写 */
function normalizeHost(host: string): string {
  return host.replace(HOST_BRACKETS_RE, '').split('%')[0].toLowerCase();
}

const isBlockedV4 = (host: string, a: number, b: number): boolean =>
  (a === 169 && b === 254) || host === '100.100.100.200';

/** 与后端 isPrivateV4 同口径：私网、回环、CGNAT、未指定、链路本地、基准测试、文档/协议保留段、组播/保留 */
const isPrivateV4 = (a: number, b: number, c: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF 协议分配
  (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 TEST-NET-1
  (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 中继
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
  (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 TEST-NET-3
  a >= 224;

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) =>
    IPV4_OCTET_RE.test(part) ? Number(part) : Number.NaN,
  );
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function classifyIpv4(
  octets: [number, number, number, number],
  host: string,
): BaseUrlHostKind {
  const [a, b, c] = octets;
  if (isBlockedV4(host, a, b)) return 'blocked';
  return isPrivateV4(a, b, c) ? 'private' : 'public';
}

/** IPv4 字面量 → 分类；不是 IPv4 时返回 null */
function classifyIpv4Literal(host: string): BaseUrlHostKind | null {
  const octets = parseIpv4(host);
  return octets ? classifyIpv4(octets, host) : null;
}

/** 两个十六进制 hextet → 点分 IPv4（非法时返回 null） */
function hextetsToV4(hiHex: string, loHex: string): string | null {
  const hi = Number.parseInt(hiHex, 16);
  const lo = Number.parseInt(loHex, 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** 封装形式里内嵌的 IPv4：映射/兼容前缀取尾两段，6to4/Teredo 取固定位置 */
function embeddedV4(host: string): string | null {
  // ::ffff:7f00:1 / ::ffff:0:7f00:1 / ::7f00:1（URL 会把点分内嵌归一成十六进制）
  if (host.startsWith('::')) {
    const groups = host.split(':').filter(Boolean);
    return groups.length >= 2
      ? hextetsToV4(groups[groups.length - 2], groups[groups.length - 1])
      : null;
  }
  if (host.startsWith('64:ff9b::')) {
    const groups = host.split(':').filter(Boolean);
    return groups.length >= 2
      ? hextetsToV4(groups[groups.length - 2], groups[groups.length - 1])
      : null;
  }
  const groups = host.split(':').filter(Boolean);
  // 6to4 2002:V4HI:V4LO::/48
  if (groups[0] === '2002' && groups.length >= 3) {
    return hextetsToV4(groups[1], groups[2]);
  }
  // Teredo 2001:0000:<服务器 IPv4>:...
  if (groups[0] === '2001' && groups[1] === '0' && groups.length >= 4) {
    return hextetsToV4(groups[2], groups[3]);
  }
  return null;
}

function classifyIpv6(host: string): BaseUrlHostKind {
  if (host === '::' || host === '::1') return 'private';
  const v4 = embeddedV4(host);
  if (v4) return classifyIpv4Literal(v4) ?? 'public';
  const first = Number.parseInt(host.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return 'blocked'; // fe80::/10 链路本地
  if ((first & 0xff00) === 0xff00) return 'private'; // ff00::/8 组播
  return 'public';
}

/** 无法解析为 URL 时返回 null（交给表单的 url 规则报错） */
export function classifyBaseUrlHost(baseUrl: string): BaseUrlHostKind | null {
  let host: string;
  try {
    host = normalizeHost(new URL(baseUrl.trim()).hostname);
  } catch {
    return null;
  }
  if (!host) return null;
  if (BLOCKED_HOSTNAMES.has(host)) return 'blocked';
  if (host.includes(':')) return classifyIpv6(host);
  const ipv4Kind = classifyIpv4Literal(host);
  if (ipv4Kind) return ipv4Kind;
  // RFC 6761：localhost / *.localhost 必指向回环
  if (host === 'localhost' || host.endsWith('.localhost')) return 'private';
  return 'public';
}
