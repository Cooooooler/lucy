import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import type { FileModuleOptions } from './options.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

/** 已存储文件的描述：字节已交给 StorageDriver，此处仅保留来源信息 */
export interface StoredFile {
  /** 存储相对路径 key（`<uuid><ext>`） */
  key: string;
  /** 扩展名（含点，如 .pdf） */
  ext: string;
  /** MIME 类型 */
  mime: string;
  /** 文件大小（字节） */
  size: number;
  /** SHA-256 校验和 */
  hash: string;
  /** 存储驱动标识，默认 'local' */
  storage: string;
}

@Injectable()
export class FileService {
  constructor(
    @Inject(FILE_STORAGE)
    private readonly storage: StorageDriver,
    @Inject(FILE_MODULE_OPTIONS)
    private readonly options: FileModuleOptions,
  ) {}

  /** 写入对象存储并返回描述（key = `<uuid><ext>`，hash = sha256）；元数据落库由消费方负责 */
  async save(input: {
    buffer: Buffer;
    ext: string;
    mime: string;
  }): Promise<StoredFile> {
    const key = `${randomUUID()}${input.ext}`;
    const size = input.buffer.length;
    const hash = createHash('sha256').update(input.buffer).digest('hex');
    const storage = this.options.storage ?? 'local';
    await this.storage.write(key, input.buffer);
    return { key, ext: input.ext, mime: input.mime, size, hash, storage };
  }

  async read(key: string): Promise<Buffer> {
    return this.storage.read(key);
  }

  async remove(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
