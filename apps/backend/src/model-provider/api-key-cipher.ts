import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * 模型 API Key 的对称加密工具（纯函数，便于单测）。
 *
 * 算法 AES-256-GCM：带认证标签，密文被篡改时解密会直接抛错，而不是悄悄返回一段错误明文。
 * 每次加密随机生成 12 字节 IV（GCM 的推荐长度），密文封装为
 * `base64(iv).base64(tag).base64(ciphertext)` 的单列文本，便于入库与迁移。
 *
 * 密钥由 `MODEL_PROVIDER_SECRET_KEY` 经 sha256 派生定长 32 字节：env 里的密钥是人可读的
 * 任意串（≥32 字符），不要求恰好 32 字节，也不要求是合法 hex。
 */

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const ALGORITHM = 'aes-256-gcm';

/** 由 env 密钥派生 32 字节 AES 密钥（sha256 定长输出） */
export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** 加密明文 API Key，返回可入库的封装密文 */
export function encryptApiKey(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.');
}

/**
 * 解密封装密文，返回明文 API Key。
 * @throws Error 密文格式非法或认证失败（被篡改 / 密钥不匹配）
 */
export function decryptApiKey(payload: string, key: Buffer): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('加密的 API Key 格式非法');
  }
  const iv = Buffer.from(ivPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');
  const data = Buffer.from(dataPart, 'base64');
  if (
    iv.length !== IV_LENGTH ||
    tag.length !== 16 ||
    key.length !== KEY_LENGTH
  ) {
    throw new Error('加密的 API Key 参数非法');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * 取明文末尾 4 位用于脱敏回显。短于 4 位时原样返回（避免暴露「极少位」的错觉，
 * 这类 Key 本身无效，仅用于展示）。
 */
export function apiKeyLast4(plain: string): string {
  return plain.slice(-4);
}

/** 由尾号生成脱敏展示串（永远不含明文前缀） */
export function maskApiKey(last4: string): string {
  return last4 ? `••••••${last4}` : '';
}
