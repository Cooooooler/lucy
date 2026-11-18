import {
  classifyHostname,
  classifyIpAddress,
  isLoopbackHostname,
  LOOPBACK_HOSTS,
  normalizeHost,
} from '@lucy/shared';
import { isIP } from 'node:net';

/**
 * 后端侧的地址判定适配层。
 *
 * 网段分类只有一份实现（`@lucy/shared` 的 base-url-host，前端表单提示也用它），
 * 这里只补 Node 特有的两件事：用 `node:net` 的 `isIP` 判定字面量（DNS 结果与配置
 * 条目都靠它区分「IP」与「域名」），把分类结果映射成守卫所需的布尔判据。
 */

export { isLoopbackHostname, LOOPBACK_HOSTS, normalizeHost };

/** 单个 IP（v4/v6 字面量）是否落在受限范围 */
export function isBlockedAddress(address: string): boolean {
  if (!isIP(address)) return false;
  return classifyIpAddress(address) === 'blocked';
}

/** 单个 IP（v4/v6 字面量）是否非公网（私网/回环/保留/内嵌 IPv4 的封装形式） */
export function isPrivateAddress(address: string): boolean {
  if (!isIP(address)) return false;
  const kind = classifyIpAddress(address);
  // blocked 是 private 的子集：链路本地/云元数据同样是「非公网」
  return kind === 'blocked' || kind === 'private';
}

/** 主机字面量（域名或 IP）是否命中受限地址；不做 DNS 解析 */
export function isBlockedHost(host: string): boolean {
  return classifyHostname(host) === 'blocked';
}
