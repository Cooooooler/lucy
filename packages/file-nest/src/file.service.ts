import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import { FileEntity } from './file.entity.js';
import type { FileModuleOptions } from './options.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

export interface SaveFileInput {
  ownerId: string;
  originalName: string;
  /** 含点，如 .pdf */
  ext: string;
  mime: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FileService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly repo: Repository<FileEntity>,
    @Inject(FILE_STORAGE)
    private readonly storage: StorageDriver,
    @Inject(FILE_MODULE_OPTIONS)
    private readonly options: FileModuleOptions,
  ) {}

  /** 写入对象存储 + 落元数据（key = `<uuid><ext>`，hash = sha256） */
  async save(input: SaveFileInput): Promise<FileEntity> {
    const id = randomUUID();
    const key = `${id}${input.ext}`;
    const hash = createHash('sha256').update(input.buffer).digest('hex');
    await this.storage.write(key, input.buffer);
    const entity = this.repo.create({
      id,
      ownerId: input.ownerId,
      originalName: input.originalName,
      ext: input.ext,
      mime: input.mime,
      size: input.size,
      key,
      hash,
      storage: this.options.storage ?? 'local',
    });
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<FileEntity | null> {
    return this.repo.findOneBy({ id });
  }

  async read(file: FileEntity): Promise<Buffer> {
    return this.storage.read(file.key);
  }

  async remove(file: FileEntity): Promise<void> {
    await this.storage.delete(file.key);
    await this.repo.delete({ id: file.id });
  }
}
