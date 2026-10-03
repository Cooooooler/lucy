import { BadRequestException } from '@nestjs/common';

/** 已知云元数据主机名（DNS 名形式） */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/** IPv4 链路本地 169.254.0.0/16（含云元数据 169.254.169.254） */
const isLinkLocalV4 = (host: string): boolean => host.startsWith('169.254.');

/** IPv6 链路本地 fe80::/10、云元数据 fd00:ec2::/64，以及 IPv4 映射的链路本地 */
function isBlockedV6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10
  if (h.startsWith('fd00:ec2:')) return true; // AWS IMDS IPv6
  // IPv4 映射：URL 会把 ::ffff:169.254.169.254 归一成 ::ffff:a9fe:a9fe，解出后 32 位再判
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const hi = Number.parseInt(mapped[1], 16);
    const lo = Number.parseInt(mapped[2], 16);
    return isLinkLocalV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return false;
}

/**
 * 校验 baseUrl 的主机不落在链路本地/云元数据地址上。
 *
 * 该地址会被 `test-connection`（及后续真实调用）在服务端发起外呼：不加限制时，认证用户
 * 可把它指向 `http://169.254.169.254/...` 之类的元数据端点做 SSRF、窃取云凭证。
 * 私网与回环**刻意放行**——本地 Ollama 常在 localhost/LAN。IPv4 用 WHATWG URL 归一化，
 * 十进制/十六进制/八进制写法（如 `http://2852039166/`）都会被还原成点分地址，无法绕过。
 *
 * 残留风险（见 issue #85）：DNS 名解析到链路本地、跟随重定向、IPv6 其它别名写法。
 * @throws BadRequestException 主机命中受限地址
 */
export function assertBaseUrlHostAllowed(baseUrl: string): void {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || isLinkLocalV4(host) || isBlockedV6(host)) {
    throw new BadRequestException(
      'API Base URL 指向受限地址（链路本地/云元数据），请检查主机',
    );
  }
}
