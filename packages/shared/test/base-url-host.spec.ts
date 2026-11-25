import { describe, expect, it } from 'vitest';
import {
  classifyHostname,
  classifyIpAddress,
  isLoopbackHostname,
  normalizeHost,
} from '../src/base-url-host.js';

describe('normalizeHost', () => {
  it('去方括号/zone、去 FQDN 尾点、小写', () => {
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('LOCALHOST.')).toBe('localhost');
    expect(normalizeHost('fe80::1%eth0')).toBe('fe80::1');
  });
});

describe('isLoopbackHostname', () => {
  it('localhost 与 *.localhost 是回环保留名', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('app.localhost')).toBe(true);
    expect(isLoopbackHostname('localhost.example.com')).toBe(false);
  });
});

describe('classifyIpAddress', () => {
  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888'])(
    '公网地址：%s',
    (address) => {
      expect(classifyIpAddress(address)).toBe('public');
    },
  );

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.1',
    '100.64.0.1',
    '198.18.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '64:ff9b::192.168.1.10',
    '64:ff9b:1::192.168.1.10',
    '2002:0a00:0001::',
  ])('私网/回环/保留地址：%s', (address) => {
    expect(classifyIpAddress(address)).toBe('private');
  });

  it.each([
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '::',
    'fe80::1',
    'fd00:ec2::254',
    '::ffff:169.254.169.254',
    '::ffff:0:169.254.169.254',
    '64:ff9b::169.254.169.254',
    '2002:a9fe:a9fe::',
    '2001:0:a9fe:a9fe::',
  ])('受限（链路本地/云元数据）地址：%s', (address) => {
    expect(classifyIpAddress(address)).toBe('blocked');
  });

  it.each(['example.com', 'vllm.lan', 'not-an-ip', ''])(
    '非 IP 字面量返回 null：%s',
    (value) => {
      expect(classifyIpAddress(value)).toBeNull();
    },
  );
});

describe('classifyHostname', () => {
  it('元数据主机名始终受限', () => {
    expect(classifyHostname('metadata.google.internal')).toBe('blocked');
    expect(classifyHostname('metadata.google.internal.')).toBe('blocked');
    expect(classifyHostname('metadata.goog')).toBe('blocked');
  });

  it('localhost / *.localhost 归为私网', () => {
    expect(classifyHostname('localhost')).toBe('private');
    expect(classifyHostname('app.localhost')).toBe('private');
  });

  it('普通域名与 IP 字面量走同一分类', () => {
    expect(classifyHostname('vllm.lan')).toBe('public');
    expect(classifyHostname('169.254.cdn.example.com')).toBe('public');
    expect(classifyHostname('192.168.1.10')).toBe('private');
    expect(classifyHostname('[::1]')).toBe('private');
    expect(classifyHostname('0.0.0.0')).toBe('blocked');
  });
});
