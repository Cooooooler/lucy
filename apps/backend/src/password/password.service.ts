import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p, keylen } = DEFAULT_PARAMS;
    const derived = await scrypt(password, salt, keylen, { N, r, p });
    return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${derived.toString('base64')}`;
  }

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
