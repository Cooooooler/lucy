import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import {
  assertBaseUrlHostAllowed,
  assertBaseUrlResolvedAllowed,
} from './base-url-guard.js';

describe('assertBaseUrlHostAllowed（主机字面量）', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://api.anthropic.com',
    'http://localhost:11434',
    'http://127.0.0.1:1/v1',
    'http://192.168.1.10:11434/v1',
    'http://[::1]:11434',
  ])('放行公网/回环/私网主机：%s', (url) => {
    expect(() => assertBaseUrlHostAllowed(url)).not.toThrow();
  });

  it.each([
    ['IPv4 链路本地/元数据', 'http://169.254.169.254/latest/meta-data'],
    ['IPv4 十进制写法（URL 归一化后仍拦截）', 'http://2852039166/'],
    ['GCP 元数据主机名', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['IPv6 链路本地', 'http://[fe80::1]/'],
    ['AWS 元数据 IPv6', 'http://[fd00:ec2::254]/'],
    ['IPv4 映射的链路本地', 'http://[::ffff:169.254.169.254]/'],
    ['IPv4 兼容写法', 'http://[::a9fe:a9fe]/'],
    ['6to4 内嵌链路本地', 'http://[2002:a9fe:a9fe::]/'],
    ['Teredo 服务器为链路本地', 'http://[2001:0:a9fe:a9fe::]/'],
    ['NAT64 内嵌链路本地', 'http://[64:ff9b::a9fe:a9fe]/'],
  ])('拒绝受限主机：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url)).toThrow(BadRequestException);
  });
});

describe('assertBaseUrlResolvedAllowed（解析后的 IP）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('域名解析到链路本地 → 拒绝（字面量校验发现不了）', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      assertBaseUrlResolvedAllowed('http://attacker.example/'),
    ).rejects.toThrow(BadRequestException);
    expect(lookup).toHaveBeenCalledWith('attacker.example', {
      all: true,
      verbatim: true,
    });
  });

  it('多个解析结果里任一命中即拒绝', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fd00:ec2::254', family: 6 },
    ]);
    await expect(
      assertBaseUrlResolvedAllowed('https://dual.example/'),
    ).rejects.toThrow(BadRequestException);
  });

  it('解析到公网地址 → 放行', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      assertBaseUrlResolvedAllowed('https://api.example.com/v1'),
    ).resolves.toBeUndefined();
  });

  it('IP 字面量走同步校验，不再做 DNS 查询', async () => {
    await expect(
      assertBaseUrlResolvedAllowed('http://127.0.0.1:11434'),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
