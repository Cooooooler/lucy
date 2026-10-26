import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { deriveKey } from './api-key-cipher.js';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import { ModelCredentialError } from './model-credential.error.js';

const SECRET =
  'b7f1c2a94e6d8035af19c4de72b0a8f3e5d61c09ab47382f6d90e1c4b8a72f35';
const cipher = new ApiKeyCipher({
  getOrThrow: (key: string) => {
    if (key === 'MODEL_PROVIDER_SECRET_KEY') return SECRET;
    throw new Error(`unexpected ${key}`);
  },
} as unknown as ConfigService);

describe('ApiKeyCipher.decrypt', () => {
  it('正常往返：encrypt 后 decrypt 还原明文', () => {
    const enc = cipher.encrypt('sk-test-abcdef');
    expect(cipher.decrypt(enc)).toBe('sk-test-abcdef');
  });

  it('密文损坏/密钥不匹配：抛 ModelCredentialError(decrypt-failed)（连接测试据此单独归因平台密钥问题）', () => {
    // 篡改一个字节：GCM 认证失败
    const tampered = `0.0.${'A'.repeat(8)}`;
    let caught: unknown;
    try {
      cipher.decrypt(tampered);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelCredentialError);
    const reason = (caught as ModelCredentialError).reason;
    expect(reason).toBe('decrypt-failed');
    expect((caught as ModelCredentialError).message).toContain(
      'API Key 解密失败',
    );
  });

  it('解密失败不改写原始语义：错误信息带原始 message（如「加密的 API Key 格式非法」）', () => {
    let caught: unknown;
    try {
      cipher.decrypt('not-a-valid-payload');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelCredentialError);
    expect((caught as ModelCredentialError).message).toContain(
      '加密的 API Key 格式非法',
    );
  });

  it('密钥派生相同：换实例也能解（同派生逻辑不变量）', () => {
    const other = new ApiKeyCipher({
      getOrThrow: () => SECRET,
    } as unknown as ConfigService);
    expect(other.decrypt(cipher.encrypt('sk-test-abcdef'))).toBe(
      'sk-test-abcdef',
    );
    expect(deriveKey(SECRET).length).toBe(32);
  });
});
