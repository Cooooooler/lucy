import { describe, expect, it } from 'vitest';
import {
  isAllowlistedHost,
  isValidAllowlistHost,
  normalizeAllowlistHost,
  parsePrivateHostAllowlist,
} from './outbound-allowlist.js';

describe('parsePrivateHostAllowlist', () => {
  it('逗号分隔、去空白、小写、IPv6 规范化为 URL.hostname 同形', () => {
    expect([
      ...parsePrivateHostAllowlist(
        ' VLLM.LAN, 192.168.1.10, [::1] , 0:0:0:0:0:0:0:2, [::ffff:192.168.1.20]',
      ),
    ]).toEqual([
      'vllm.lan',
      '192.168.1.10',
      '::1',
      '::2',
      // WHATWG 把 IPv4 映射地址改写成十六进制，白名单必须存同一形式才能匹配
      '::ffff:c0a8:114',
    ]);
  });

  it('缺失/空串/非字符串返回空集合', () => {
    expect(parsePrivateHostAllowlist(undefined).size).toBe(0);
    expect(parsePrivateHostAllowlist('').size).toBe(0);
    expect(parsePrivateHostAllowlist(42).size).toBe(0);
  });

  it('非法条目直接丢弃（启动期校验之外的兜底）', () => {
    expect([
      ...parsePrivateHostAllowlist(
        'vllm.lan, http://other.lan, vllm.lan:8000, 169.254.169.254',
      ),
    ]).toEqual(['vllm.lan']);
  });
});

describe('isValidAllowlistHost', () => {
  it.each(['vllm.lan', '192.168.1.20', '[::1]', 'vllm2.lan.'])(
    '接受可生效的主机名/IP：%s',
    (entry) => {
      expect(isValidAllowlistHost(entry)).toBe(true);
    },
  );

  it.each([
    'http://vllm.lan',
    'vllm.lan:8000',
    'vllm.lan/path',
    '0.0.0.0',
    '::',
    '169.254.169.254',
    'metadata.google.internal',
  ])('拒绝不可生效的条目：%s', (entry) => {
    expect(isValidAllowlistHost(entry)).toBe(false);
  });
});

describe('isAllowlistedHost', () => {
  it('按 URL 主机名与白名单同一归一化形态匹配', () => {
    const allowlist = parsePrivateHostAllowlist('VLLM.LAN,127.0.0.1');
    expect(isAllowlistedHost('http://vllm.lan.:8000/v1', allowlist)).toBe(true);
    expect(isAllowlistedHost('http://127.0.0.1:11434', allowlist)).toBe(true);
    expect(isAllowlistedHost('http://other.lan', allowlist)).toBe(false);
    expect(isAllowlistedHost('http://vllm.lan', new Set())).toBe(false);
  });
});

describe('normalizeAllowlistHost', () => {
  it('与运行期 URL.hostname 同形（IPv6 压缩、尾点、大小写）', () => {
    expect(normalizeAllowlistHost('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(normalizeAllowlistHost('VLLM.LAN.')).toBe('vllm.lan');
    expect(normalizeAllowlistHost('  ')).toBe('');
  });
});
