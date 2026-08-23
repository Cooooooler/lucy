import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorageDriver } from './local-storage.driver.js';

describe('LocalStorageDriver', () => {
  let dir: string;
  let driver: LocalStorageDriver;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-nest-'));
    driver = new LocalStorageDriver({ dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write 后 read 能取回相同内容', async () => {
    await driver.write('a.txt', Buffer.from('hello'));
    expect(await driver.read('a.txt')).toEqual(Buffer.from('hello'));
  });

  it('write 自动创建目录', async () => {
    await driver.write('sub/b.txt', Buffer.from('x'));
    expect(await driver.read('sub/b.txt')).toEqual(Buffer.from('x'));
  });

  it('delete 删除文件，重复 delete 不抛错', async () => {
    await driver.write('c.txt', Buffer.from('y'));
    await driver.delete('c.txt');
    await expect(driver.read('c.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(driver.delete('c.txt')).resolves.toBeUndefined();
  });

  it('delete 遇到非 ENOENT 错误（如目录）重抛，不静默吞掉', async () => {
    await driver.write('sub/d.txt', Buffer.from('x'));
    // 不存在文件 → ENOENT 视为已删成功
    await expect(driver.delete('no-such.txt')).resolves.toBeUndefined();
    // 对目录执行 unlink → EISDIR/EPERM 等非 ENOENT 错误应重抛
    await expect(driver.delete('sub')).rejects.toThrow();
  });

  it('拒绝含 .. / \\ 的 key（防路径穿越）', async () => {
    await expect(
      driver.write('../evil.txt', Buffer.from('z')),
    ).rejects.toThrow();
    await expect(driver.write('a\\b.txt', Buffer.from('z'))).rejects.toThrow();
  });
});
