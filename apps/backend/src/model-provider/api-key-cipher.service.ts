import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  apiKeyLast4,
  decryptApiKey,
  deriveKey,
  encryptApiKey,
  maskApiKey,
} from './api-key-cipher.js';
import { ModelCredentialError } from './model-credential.error.js';

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

  /**
   * 解密密文 API Key。
   *
   * 解密失败（密文格式非法/认证失败）意味着 `MODEL_PROVIDER_SECRET_KEY` 已轮换或密文
   * 被破坏——与 provider 的 baseUrl/类型无关，裸 Error 会让调用方（连接测试/对话链路）
   * 把它跟「供应商不可达」归到同一句兜底文案。这里收成 `ModelCredentialError`，
   * 连接测试即可单独映射出「平台密钥已变更，请重新保存 API Key」。
   * @throws ModelCredentialError 解密失败
   */
  decrypt(payload: string): string {
    try {
      return decryptApiKey(payload, this.key);
    } catch (error) {
      throw new ModelCredentialError(
        'decrypt-failed',
        `API Key 解密失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        // 原始错误挂 cause（含栈）：排查看得到根因位置，而不是只剩一句拼接文案
        { cause: error },
      );
    }
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
