import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  apiKeyLast4,
  decryptApiKey,
  deriveKey,
  encryptApiKey,
  maskApiKey,
} from './api-key-cipher.js';

/**
 * 把纯函数加密工具接进 DI：构造期从 ConfigService 读取 `MODEL_PROVIDER_SECRET_KEY` 并派生密钥，
 * 之后所有加密/解密复用同一份 Buffer。
 *
 * 密钥用 `getOrThrow`：env schema 已把该项设为 required，走到这里取不到即为装配错误，
 * 应尽早抛出而不是退化成「用空密钥加密」（那等于明文入库）。
 */
@Injectable()
export class ApiKeyCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = deriveKey(
      config.getOrThrow<string>('MODEL_PROVIDER_SECRET_KEY'),
    );
  }

  /** 加密明文 API Key */
  encrypt(plain: string): string {
    return encryptApiKey(plain, this.key);
  }

  /** 解密密文 API Key */
  decrypt(payload: string): string {
    return decryptApiKey(payload, this.key);
  }

  /** 取明文尾号（用于落库，避免每次展示都解密） */
  last4(plain: string): string {
    return apiKeyLast4(plain);
  }

  /** 由尾号生成脱敏展示串 */
  mask(last4: string): string {
    return maskApiKey(last4);
  }
}
