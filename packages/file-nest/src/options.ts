import type { ModuleMetadata } from '@nestjs/common';
import type { StorageDriver } from './storage/storage-driver.interface.js';

/** forRoot 的模块选项 */
export interface FileModuleOptions {
  /** storage 根目录（LocalStorageDriver 用），默认 process.env.UPLOAD_DIR ?? 'uploads' */
  dir?: string;
  /** 存储驱动标识（写入调用方持久化的文件元数据），默认 'local' */
  storage?: string;
  /** 注入自定义存储驱动；缺省用 LocalStorageDriver(dir) */
  driver?: StorageDriver;
}

/** forRootAsync 的异步配置：useFactory 可注入依赖（如 ConfigService）读取选项 */
export interface FileModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<FileModuleOptions> | FileModuleOptions;
}
