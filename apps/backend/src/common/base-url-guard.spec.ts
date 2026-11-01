import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import { BaseUrlBlockedError } from './base-url-blocked.error.js';
import {
  assertBaseUrlHostAllowed,
  isBlockedAddress,
  resolveAllowedAddresses,
} from './base-url-guard.js';

describe('assertBaseUrlHostAllowed（主机字面量）', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://api.anthropic.com',
    'http://localhost:11434',
    'http://127.0.0.1:1/v1',
    'http://192.168.1.10:11434/v1',
    'http://[::1]:11434',
    // 域名恰好以 169.254. 开头不是 IP 字面量，不能被前缀规则误杀
    'http://169.254.cdn.example.com/',
  ])('放行公网/回环/私网主机：%s', (url) => {
    expect(() => assertBaseUrlHostAllowed(url)).not.toThrow();
  });

  it.each([
    ['IPv4 链路本地/元数据', 'http://169.254.169.254/latest/meta-data'],
    ['阿里云 ECS 元数据', 'http://100.100.100.200/latest/meta-data'],
    ['IPv4 十进制写法（URL 归一化后仍拦截）', 'http://2852039166/'],
    ['GCP 元数据主机名', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['IPv6 链路本地', 'http://[fe80::1]/'],
    ['AWS 元数据 IPv6', 'http://[fd00:ec2::254]/'],
    ['IPv4 映射的链路本地', 'http://[::ffff:169.254.169.254]/'],
    ['IPv4 映射的阿里云元数据', 'http://[::ffff:100.100.100.200]/'],
    ['NAT64 内嵌阿里云元数据', 'http://[64:ff9b::100.100.100.200]/'],
    ['6to4 内嵌阿里云元数据', 'http://[2002:6464:64c8::]/'],
    ['IPv4 兼容写法', 'http://[::a9fe:a9fe]/'],
    ['6to4 内嵌链路本地', 'http://[2002:a9fe:a9fe::]/'],
    ['Teredo 服务器为链路本地', 'http://[2001:0:a9fe:a9fe::]/'],
    ['NAT64 内嵌链路本地', 'http://[64:ff9b::a9fe:a9fe]/'],
  ])('拒绝受限主机：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url)).toThrow(BaseUrlBlockedError);
  });
});

describe('isBlockedAddress（DNS 解析结果可能是点分内嵌形式）', () => {
  it.each([
    '169.254.169.254',
    '100.100.100.200',
    '::ffff:100.100.100.200',
    '64:ff9b::100.100.100.200',
    '2002:6464:64c8::',
    '::ffff:169.254.169.254',
    '::ffff:0:169.254.169.254',
    '64:ff9b::169.254.169.254',
    '::169.254.169.254',
    '2002:a9fe:a9fe::',
    '2001:0:a9fe:a9fe::',
    'fe80::1',
    'fd00:ec2::254',
  ])('受限地址：%s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    // 只拦精确的元数据端点，同 /24 的 CGNAT/Tailscale 地址仍放行
    '100.100.100.201',
    '::1',
    '::ffff:8.8.8.8',
    '64:ff9b::8.8.8.8',
    '2001:4860:4860::8888',
  ])('非受限地址：%s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('resolveAllowedAddresses（解析后校验，供连接期钉住地址）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('域名解析到链路本地 → 拒绝（字面量校验发现不了）', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(resolveAllowedAddresses('attacker.example')).rejects.toThrow(
      BaseUrlBlockedError,
    );
    expect(lookup).toHaveBeenCalledWith('attacker.example', {
      all: true,
      verbatim: true,
    });
  });

  it('多个解析结果里任一命中即拒绝（含内嵌 IPv4 的 IPv6）', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '64:ff9b::169.254.169.254', family: 6 },
    ]);
    await expect(resolveAllowedAddresses('dual.example')).rejects.toThrow(
      BaseUrlBlockedError,
    );
  });

  it('解析到公网地址 → 返回已校验地址（供连接钉住）', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(resolveAllowedAddresses('api.example.com')).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
  });

  it('IP 字面量走同步校验，不再做 DNS 查询', async () => {
    await expect(resolveAllowedAddresses('127.0.0.1')).resolves.toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('受限 IP 字面量直接拒绝', async () => {
    await expect(resolveAllowedAddresses('169.254.169.254')).rejects.toThrow(
      BaseUrlBlockedError,
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});
