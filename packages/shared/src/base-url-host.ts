/**
 * Base URL 主机的地址分类（前后端共用，纯函数、无 Node API）。
 *
 * 后端是权威：守卫据此决定放行/拒绝，前端只用于表单即时提示。两边此前各维护
 * 一份相同的网段判定，任何一侧漏改都会造成「前端说可以的地址后端拒绝」。
 */

export type BaseUrlHostKind = 'public' | 'private' | 'blocked';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/** 保留回环地址：白名单里任一形式都等价放行 `localhost` / `*.localhost` */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

/**
 * 主机名/字面量归一化：去方括号与 zone、去 FQDN 尾点、小写。
 *
 * WHATWG URL 保留尾点（`http://localhost./` 的 hostname 是 `localhost.`），不归一化会
 * 让保存期校验与白名单匹配漏掉这种等价写法。
 */
export function normalizeHost(host: string): string {
  return host
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * `localhost` / `*.localhost` 按 RFC 6761 应解析到回环。
 *
 * 保存校验是同步、不做 DNS 的，只靠 IP 字面量判定会漏掉这个最常见写法。
 */
export function isLoopbackHostname(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

/** IPv4 链路本地 169.254.0.0/16（含云元数据 169.254.169.254） */
const isLinkLocalV4 = (host: string): boolean => host.startsWith('169.254.');

/** 阿里云 ECS 元数据 100.100.100.200（不在链路本地段，需单独拦；只匹配精确 IP） */
const isAliyunMetadataV4 = (host: string): boolean =>
  host === '100.100.100.200';

/** IPv4 未指定地址：Linux 上连接 0.0.0.0 会被路由到本机回环，任何策略都拒绝 */
const isUnspecifiedV4 = (host: string): boolean => host === '0.0.0.0';

/** IPv4 受限地址：链路本地 + 云元数据精确端点 + 未指定地址 */
const isBlockedV4 = (host: string): boolean =>
  isLinkLocalV4(host) || isAliyunMetadataV4(host) || isUnspecifiedV4(host);

/**
 * IPv4 非公网地址：私网、回环、CGNAT、未指定、链路本地、基准测试、文档/协议
 * 保留段与组播/保留段。
 *
 * 指向这些地址等同于「拿服务端身份去探测内网」，因此默认拒绝；只有运维显式
 * 列进白名单的主机才放行。
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

/** 严格的点分 IPv4（拒绝前导零与缩写形式，与 `node:net` 的 isIP 同口径） */
const IPV4_OCTET_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => IPV4_OCTET_RE.test(part))) return null;
  return parts.map(Number) as [number, number, number, number];
}

/**
 * IPv6 字面量 → 16 字节。支持 `::` 压缩与尾部点分内嵌 IPv4
 * （`::ffff:169.254.169.254`、`64:ff9b::169.254.169.254` 等）。
 *
 * 不对字符串做正则匹配：点分内嵌形式不会匹配十六进制 hextet 正则，
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
function isBlockedV6(bytes: number[]): boolean {
  // 未指定地址 ::（Linux 上连接会路由到本机回环，白名单也不能豁免）
  if (bytes.every((byte) => byte === 0)) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (
    bytes[0] === 0xfd &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x0e &&
    bytes[3] === 0xc2
  ) {
    return true; // AWS IMDS IPv6 fd00:ec2::/64
  }
  const v4 = embeddedV4(bytes);
  return v4 !== null && isBlockedV4(v4);
}

/**
 * IPv6 非公网地址：未指定 `::`、回环 `::1`、唯一本地 fc00::/7、
 * 链路本地 fe80::/10、site-local fec0::/10（已废弃）、组播 ff00::/8、
 * 文档段 2001:db8::/32，以及内嵌 IPv4 的私网形式（`::ffff:127.0.0.1` 等）。
 */
function isPrivateV6(bytes: number[]): boolean {
  if (bytes.every((byte) => byte === 0)) return true; // ::
  if (allZero(bytes, 0, 15) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local（已废弃）
  if (bytes[0] === 0xff) return true; // ff00::/8 组播（对齐 IPv4 的 a >= 224）
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return true; // 2001:db8::/32 文档段
  }
  const v4 = embeddedV4(bytes);
  return v4 !== null && isPrivateV4(v4);
}

/**
 * 已归一化 IP 字面量的分类；不是 IP 字面量时返回 null。
 *
 * `blocked` 是 `private` 的子集：链路本地/云元数据任何策略都拒绝，
 * 私网/回环则可由运维白名单放行。
 */
export function classifyIpAddress(host: string): BaseUrlHostKind | null {
  const bare = normalizeHost(host);
  if (!bare) return null;
  if (bare.includes(':')) {
    const bytes = ipv6ToBytes(bare);
    if (!bytes) return null;
    if (isBlockedV6(bytes)) return 'blocked';
    return isPrivateV6(bytes) ? 'private' : 'public';
  }
  if (!parseIpv4(bare)) return null;
  if (isBlockedV4(bare)) return 'blocked';
  return isPrivateV4(bare) ? 'private' : 'public';
}

/**
 * 主机名或 IP 字面量的分类（入口函数）。
 *
 * 域名不做前缀判断：`169.254.cdn.example.com` 是合法域名，不能因前缀被误判；
 * `localhost` / `*.localhost` 按 RFC 6761 归为回环。
 */
export function classifyHostname(host: string): BaseUrlHostKind {
  const bare = normalizeHost(host);
  if (!bare) return 'public';
  if (BLOCKED_HOSTNAMES.has(bare)) return 'blocked';
  const ip = classifyIpAddress(bare);
  if (ip) return ip;
  return isLoopbackHostname(bare) ? 'private' : 'public';
}
