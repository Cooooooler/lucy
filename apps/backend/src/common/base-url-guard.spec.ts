import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import {
  BaseUrlBlockedError,
  BaseUrlPrivateAddressError,
} from './base-url-blocked.error.js';
import {
  assertBaseUrlHostAllowed,
  isBlockedAddress,
  isPrivateAddress,
  parsePrivateHostAllowlist,
  resolveAllowedAddresses,
  type BaseUrlPolicy,
} from './base-url-guard.js';

/** 本地模型（Ollama）与 tokenizer 的策略：私网/回环整体放行 */
const permissive: BaseUrlPolicy = { allowPrivateHosts: true };
/** 云端供应商的策略：只许公网 */
const strict: BaseUrlPolicy = { allowPrivateHosts: false };

describe('assertBaseUrlHostAllowed（放行私网的策略）', () => {
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
    expect(() => assertBaseUrlHostAllowed(url, permissive)).not.toThrow();
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
  ])('拒绝受限主机（私网策略也不放行）：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url, permissive)).toThrow(
      BaseUrlBlockedError,
    );
  });
});

describe('assertBaseUrlHostAllowed（仅公网策略：云端 vendor）', () => {
  it.each([
    ['api.openai.com', 'https://api.openai.com/v1'],
    ['api.anthropic.com', 'https://api.anthropic.com'],
    ['公网 IP', 'http://8.8.8.8/v1'],
  ])('放行公网主机：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url, strict)).not.toThrow();
  });

  it.each([
    ['回环 IPv4', 'http://127.0.0.1:11434/v1'],
    // RFC 6761 保留名：保存期不解析 DNS 也要拦住
    ['localhost 主机名', 'http://localhost:11434/v1'],
    ['*.localhost 主机名', 'http://ollama.localhost:11434/v1'],
    ['10/8 私网', 'http://10.0.0.5/v1'],
    ['172.16/12 私网', 'http://172.20.1.1/v1'],
    ['192.168/16 私网', 'http://192.168.1.10:8080/v1'],
    ['未指定地址', 'http://0.0.0.0/'],
    ['CGNAT', 'http://100.64.0.1/'],
    ['基准测试段', 'http://198.18.0.1/'],
    ['IPv6 回环', 'http://[::1]:11434'],
    ['IPv6 ULA', 'http://[fc00::1]/'],
    ['IPv4 映射的回环', 'http://[::ffff:127.0.0.1]/'],
    ['NAT64 内嵌私网', 'http://[64:ff9b::192.168.1.10]/'],
    ['6to4 内嵌私网', 'http://[2002:0a00:0001::]/'],
  ])('拒绝私网/回环主机：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url, strict)).toThrow(
      BaseUrlPrivateAddressError,
    );
  });

  it('白名单按配置里书写的主机名/字面量放行，但不解除元数据拦截', () => {
    const policy: BaseUrlPolicy = {
      allowPrivateHosts: false,
      allowedPrivateHosts: new Set(['vllm.lan', '192.168.1.10', '::1']),
    };
    expect(() =>
      assertBaseUrlHostAllowed('http://vllm.lan:8000/v1', policy),
    ).not.toThrow();
    // 显式列出的 localhost 也放行（运维自担）
    expect(() =>
      assertBaseUrlHostAllowed('http://localhost:8000/v1', {
        allowPrivateHosts: false,
        allowedPrivateHosts: new Set(['localhost']),
      }),
    ).not.toThrow();
    expect(() =>
      assertBaseUrlHostAllowed('http://192.168.1.10:8000/v1', policy),
    ).not.toThrow();
    expect(() =>
      assertBaseUrlHostAllowed('http://[::1]:11434/v1', policy),
    ).not.toThrow();
    // 白名单只解除「私网/回环」，链路本地与云元数据始终拦截
    expect(() =>
      assertBaseUrlHostAllowed('http://169.254.169.254/', policy),
    ).toThrow(BaseUrlBlockedError);
    // 同网段但未列出的地址仍拒绝
    expect(() =>
      assertBaseUrlHostAllowed('http://192.168.1.11/', policy),
    ).toThrow(BaseUrlPrivateAddressError);
  });
});

describe('parsePrivateHostAllowlist', () => {
  it('逗号分隔、去空白、小写、去 IPv6 方括号', () => {
    expect([
      ...parsePrivateHostAllowlist(' VLLM.LAN, 192.168.1.10, [::1] ,'),
    ]).toEqual(['vllm.lan', '192.168.1.10', '::1']);
  });

  it('缺失/空串/非字符串返回空集合', () => {
    expect(parsePrivateHostAllowlist(undefined).size).toBe(0);
    expect(parsePrivateHostAllowlist('').size).toBe(0);
    expect(parsePrivateHostAllowlist(42).size).toBe(0);
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

describe('isPrivateAddress（仅公网策略下要额外拦截的地址）', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.1',
    '0.0.0.0',
    '100.64.0.1',
    '169.254.1.1',
    '198.19.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '2002:7f00:0001::',
    '64:ff9b::10.0.0.1',
  ])('非公网：%s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    // 边界外：172.32/12 之外、CGNAT 之后的 100.128/、192.169/
    '172.32.0.1',
    '100.128.0.1',
    '192.169.0.1',
    '198.20.0.1',
    '::ffff:8.8.8.8',
    '2001:4860:4860::8888',
  ])('公网：%s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('resolveAllowedAddresses（解析后校验，供连接期钉住地址）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('域名解析到链路本地 → 拒绝（字面量校验发现不了）', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      resolveAllowedAddresses('attacker.example', strict),
    ).rejects.toThrow(BaseUrlBlockedError);
    expect(lookup).toHaveBeenCalledWith('attacker.example', {
      all: true,
      verbatim: true,
    });
  });

  it('多个解析结果里任一命中受限地址即拒绝（含内嵌 IPv4 的 IPv6）', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '64:ff9b::169.254.169.254', family: 6 },
    ]);
    await expect(
      resolveAllowedAddresses('dual.example', permissive),
    ).rejects.toThrow(BaseUrlBlockedError);
  });

  it('解析到公网地址 → 返回已校验地址（供连接钉住）', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      resolveAllowedAddresses('api.example.com', strict),
    ).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('仅公网策略：解析到私网地址即拒绝（字面量校验发现不了）', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.5', family: 4 }]);
    await expect(
      resolveAllowedAddresses('intranet.example', strict),
    ).rejects.toThrow(BaseUrlPrivateAddressError);
  });

  it('放行私网的策略：解析到私网地址仍返回', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    await expect(
      resolveAllowedAddresses('ollama.lan', permissive),
    ).resolves.toEqual([{ address: '10.0.0.8', family: 4 }]);
  });

  it('白名单主机：解析到私网地址也放行；未列出的主机仍拒绝', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.5', family: 4 }]);
    const policy: BaseUrlPolicy = {
      allowPrivateHosts: false,
      allowedPrivateHosts: new Set(['vllm.lan']),
    };
    await expect(resolveAllowedAddresses('vllm.lan', policy)).resolves.toEqual([
      { address: '192.168.1.5', family: 4 },
    ]);
    await expect(resolveAllowedAddresses('other.lan', policy)).rejects.toThrow(
      BaseUrlPrivateAddressError,
    );
  });

  it('IP 字面量走同步校验，不再做 DNS 查询（允许私网时返回回环）', async () => {
    await expect(
      resolveAllowedAddresses('127.0.0.1', permissive),
    ).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('仅公网策略：回环/私网字面量直接拒绝', async () => {
    await expect(resolveAllowedAddresses('127.0.0.1', strict)).rejects.toThrow(
      BaseUrlPrivateAddressError,
    );
    await expect(resolveAllowedAddresses('10.0.0.1', strict)).rejects.toThrow(
      BaseUrlPrivateAddressError,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('受限 IP 字面量在两种策略下都拒绝', async () => {
    await expect(
      resolveAllowedAddresses('169.254.169.254', permissive),
    ).rejects.toThrow(BaseUrlBlockedError);
    await expect(
      resolveAllowedAddresses('169.254.169.254', strict),
    ).rejects.toThrow(BaseUrlBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });
});
