import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertBaseUrlHostAllowed } from './base-url-guard.js';

describe('assertBaseUrlHostAllowed', () => {
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
  ])('拒绝受限主机：%s', (_label, url) => {
    expect(() => assertBaseUrlHostAllowed(url)).toThrow(BadRequestException);
  });
});
