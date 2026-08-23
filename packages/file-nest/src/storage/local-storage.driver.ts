import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StorageDriver } from './storage-driver.interface.js';

export interface LocalStorageDriverConfig {
  /** storage 根目录，默认 process.env.UPLOAD_DIR ?? 'uploads' */
  dir?: string;
}

/** 本地磁盘存储驱动：文件落在 `dir/<key>`，目录自动创建；key 为相对路径，通常为单层文件名（FileService 约定），驱动不强制单层。 */
export class LocalStorageDriver implements StorageDriver {
  private readonly dir: string;

  constructor(config: LocalStorageDriverConfig = {}) {
    this.dir = resolve(config.dir ?? process.env.UPLOAD_DIR ?? 'uploads');
  }

  private path(key: string): string {
    // 拦截路径穿越：`..` 可逃逸根目录，`\` 在 Windows 等价于路径分隔符。
    // 允许 `/`（支持子目录落盘，见「write 自动创建目录」用例）。
    if (key.includes('\\') || key.includes('..')) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return join(this.dir, key);
  }

  async write(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
}
