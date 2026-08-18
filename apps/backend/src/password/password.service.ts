import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// scrypt 工作因子：N 内存/CPU 成本（2 的幂）、r 块大小、p 并行度、keylen 派生密钥长度。
// N=2^14 在登录延迟与安全性间折中（OWASP 交互登录基线为 2^17）；参数自包含进哈希串，
// 日后调参无需重哈希历史密码（verify 从串中按需还原参数）。
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

@Injectable()
export class PasswordService {
  /**
   * 生成自包含哈希串：`scrypt:<N>:<r>:<p>:<salt base64>:<derived base64>`。
   * salt 每次随机，使相同密码产生不同哈希；derived 为 keylen=64 的派生密钥。
   */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p, keylen } = DEFAULT_PARAMS;
    const derived = await scrypt(password, salt, keylen, { N, r, p });
    return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${derived.toString('base64')}`;
  }

  /**
   * 校验密码：解析自包含哈希串还原 N/r/p/salt/keylen 后重新派生，
   * 以 timingSafeEqual 恒定时间比较防御时序侧信道。
   * 任何格式/参数非法均返回 false（fail-closed），不抛异常。
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (
      !Number.isInteger(N) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      N < 2 ||
      r < 1 ||
      p < 1 ||
      (N & (N - 1)) !== 0
    ) {
      return false;
    }
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  }
}
