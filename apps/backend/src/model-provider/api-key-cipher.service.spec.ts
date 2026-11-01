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

  it('密钥不匹配（密文由旧 secret 加密）：GCM 认证失败，抛 ModelCredentialError(decrypt-failed)（连接测试据此单独归因平台密钥问题）', () => {
    // 密钥轮换的真实形态：老 secret 加密的密文用新 secret 解。密文各段长度都合法，
    // 只有认证标签对不上——必须走到 decipher.final() 才失败（格式/参数非法是另一条分支）
    const rotated = new ApiKeyCipher({
      getOrThrow: () => `${SECRET.slice(0, -8)}deadbeef`,
    } as unknown as ConfigService);
    const payload = rotated.encrypt('sk-test-abcdef');
    let caught: unknown;
    try {
      cipher.decrypt(payload);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelCredentialError);
    const reason = (caught as ModelCredentialError).reason;
    expect(reason).toBe('decrypt-failed');
    expect((caught as ModelCredentialError).message).toContain(
      'API Key 解密失败',
    );
    // 断言确实是认证失败语义，而不是被长度/格式校验提前拦下
    expect((caught as ModelCredentialError).message).not.toMatch(
      /格式非法|参数非法/,
    );
    expect(((caught as ModelCredentialError).cause as Error).message).toMatch(
      /authenticate|unable to|bad decrypt/i,
    );
    expect((caught as ModelCredentialError).userMessage).toBe(
      '平台密钥已变更，请重新保存 API Key',
    );
  });

  it('密文长度/格式非法：归因 corrupt（不是密钥轮换），提示重存而非「平台密钥已变更」', () => {
    // 各段 base64 合法但 iv 只有 0 字节：参数校验分支，与 GCM 认证失败是两回事
    let caught: unknown;
    try {
      cipher.decrypt(`0.0.${'A'.repeat(8)}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelCredentialError);
    expect((caught as ModelCredentialError).reason).toBe('corrupt');
    expect((caught as ModelCredentialError).message).toContain(
      '加密的 API Key 参数非法',
    );
    expect((caught as ModelCredentialError).userMessage).toBe(
      'API Key 密文损坏，请重新保存',
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
    expect((caught as ModelCredentialError).reason).toBe('corrupt');
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
