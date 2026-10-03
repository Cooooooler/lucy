import { describe, expect, it } from 'vitest';
import {
  apiKeyLast4,
  decryptApiKey,
  deriveKey,
  encryptApiKey,
  maskApiKey,
} from './api-key-cipher.js';

describe('api-key-cipher', () => {
  const key = deriveKey('test-model-provider-secret-32-chars-long');

  it('派生出 32 字节定长密钥', () => {
    expect(key.length).toBe(32);
    // 同一密钥串派生结果稳定，不同串不同
    expect(deriveKey('a'.repeat(32)).equals(deriveKey('b'.repeat(32)))).toBe(
      false,
    );
  });

  it('加解密往返还原明文', () => {
    const plain = 'sk-1234567890abcdefghijklmn';
    const payload = encryptApiKey(plain, key);
    expect(payload).not.toContain(plain);
    expect(decryptApiKey(payload, key)).toBe(plain);
  });

  it('同一明文两次加密得到不同密文（随机 IV）', () => {
    const a = encryptApiKey('sk-same', key);
    const b = encryptApiKey('sk-same', key);
    expect(a).not.toBe(b);
    expect(decryptApiKey(a, key)).toBe('sk-same');
    expect(decryptApiKey(b, key)).toBe('sk-same');
  });

  it('密文被篡改时解密抛错（GCM 认证失败）', () => {
    const payload = encryptApiKey('sk-secret', key);
    const parts = payload.split('.');
    parts[2] = Buffer.from('tampered').toString('base64');
    expect(() => decryptApiKey(parts.join('.'), key)).toThrow();
  });

  it('格式非法时抛错', () => {
    expect(() => decryptApiKey('not-a-payload', key)).toThrow();
  });

  it('密钥不匹配时解密抛错', () => {
    const payload = encryptApiKey('sk-secret', key);
    const otherKey = deriveKey('another-secret-another-secret-32chars');
    expect(() => decryptApiKey(payload, otherKey)).toThrow();
  });

  it('last4 取末四位；短明文（≤4 位）不回显，避免泄漏整把 Key', () => {
    expect(apiKeyLast4('sk-1234567890abcd')).toBe('abcd');
    // ≤4 位时「末 4 位」即整把 Key，落库/回显都会全泄露，宁可不展示
    expect(apiKeyLast4('abcd')).toBe('');
    expect(apiKeyLast4('abc')).toBe('');
    expect(maskApiKey('abcd')).toBe('••••••abcd');
    expect(maskApiKey('')).toBe('');
  });
});
