import { classifyBaseUrlHost } from '@/components/model-provider/base-url-guard';
import { describe, expect, it } from 'vitest';

describe('classifyBaseUrlHost', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://api.anthropic.com',
    'http://8.8.8.8/v1',
    'http://vllm.lan:8000/v1',
    'http://172.32.0.1/v1',
    'http://100.128.0.1/v1',
    'http://[2001:4860:4860::8888]/',
  ])('公网主机：%s', (url) => {
    expect(classifyBaseUrlHost(url)).toBe('public');
  });

  it.each([
    ['localhost', 'http://localhost:11434'],
    ['localhost（FQDN 尾点）', 'http://localhost./'],
    ['*.localhost', 'http://a.localhost:11434'],
    ['回环 IPv4', 'http://127.0.0.1:8000/v1'],
    ['10/8', 'http://10.0.0.5/v1'],
    ['172.16/12', 'http://172.20.1.1/v1'],
    ['192.168/16', 'http://192.168.1.10:8080/v1'],
    ['CGNAT', 'http://100.64.0.1/'],
    ['IETF 协议分配段', 'http://192.0.0.9/'],
    ['TEST-NET-1', 'http://192.0.2.1/'],
    ['TEST-NET-2', 'http://198.51.100.7/'],
    ['TEST-NET-3', 'http://203.0.113.9/'],
    ['IPv6 回环', 'http://[::1]:11434'],
    ['IPv6 ULA', 'http://[fc00::1]/'],
    ['IPv6 site-local（已废弃）', 'http://[fec0::1]/'],
    ['IPv6 组播', 'http://[ff02::1]/'],
    ['IPv6 文档段', 'http://[2001:db8::1]/'],
    ['IPv4 映射的回环（URL 归一化为十六进制）', 'http://[::ffff:127.0.0.1]/'],
    ['NAT64 内嵌私网', 'http://[64:ff9b::192.168.1.10]/'],
    ['RFC 8215 本地 NAT64 内嵌私网', 'http://[64:ff9b:1::192.168.1.10]/'],
    ['6to4 内嵌私网', 'http://[2002:0a00:0001::]/'],
  ])('私网/回环主机：%s', (_label, url) => {
    expect(classifyBaseUrlHost(url)).toBe('private');
  });

  it.each([
    ['IPv4 链路本地/元数据', 'http://169.254.169.254/latest/meta-data'],
    ['未指定地址 IPv4', 'http://0.0.0.0/'],
    ['未指定地址 IPv6', 'http://[::]/'],
    ['阿里云元数据', 'http://100.100.100.200/'],
    ['IPv6 链路本地', 'http://[fe80::1]/'],
    ['AWS 元数据 IPv6', 'http://[fd00:ec2::254]/'],
    ['IPv4 映射的元数据', 'http://[::ffff:169.254.169.254]/'],
    ['GCP 元数据主机名', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['GCP 元数据主机名（尾点）', 'http://metadata.google.internal./'],
  ])('受限主机：%s', (_label, url) => {
    expect(classifyBaseUrlHost(url)).toBe('blocked');
  });

  it.each(['', 'not a url', 'localhost:11434'])(
    '无法解析为 URL 时返回 null：%s',
    (value) => {
      expect(classifyBaseUrlHost(value)).toBeNull();
    },
  );

  it('重复分类同一输入时复用缓存且结果不变', () => {
    expect(classifyBaseUrlHost('http://127.0.0.1/')).toBe('private');
    expect(classifyBaseUrlHost('http://127.0.0.1/')).toBe('private');
    expect(classifyBaseUrlHost('http://8.8.8.8/')).toBe('public');
    expect(classifyBaseUrlHost('http://127.0.0.1/')).toBe('private');
  });
});
