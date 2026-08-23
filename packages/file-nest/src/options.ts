import type { ModuleMetadata } from '@nestjs/common';
import type { StorageDriver } from './storage/storage-driver.interface.js';

export interface FileModuleOptions {
  /** storage 根目录（LocalStorageDriver 用），默认 process.env.UPLOAD_DIR ?? 'uploads' */
  dir?: string;
  /** 存储驱动标识（写入 FileEntity.storage），默认 'local' */
  storage?: string;
  /** 注入自定义存储驱动；缺省用 LocalStorageDriver(dir) */
  driver?: StorageDriver;
}

export interface FileModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<FileModuleOptions> | FileModuleOptions;
}
