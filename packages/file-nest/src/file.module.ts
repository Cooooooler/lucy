import { DynamicModule, Module } from '@nestjs/common';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import { FileService } from './file.service.js';
import type { FileModuleAsyncOptions, FileModuleOptions } from './options.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

/**
 * 解析存储驱动：优先注入的 driver，否则用 `LocalStorageDriver(dir)`。
 *
 * @param opts 模块选项
 * @returns 实际使用的存储驱动实例
 */
export function resolveStorageDriver(opts: FileModuleOptions): StorageDriver {
  return opts.driver ?? new LocalStorageDriver({ dir: opts.dir });
}

/** 文件模块：`forRoot`/`forRootAsync` 全局注册存储驱动与 `FileService`。 */
@Module({})
export class FileModule {
  /**
   * 同步注册全局文件模块。
   *
   * @param options 模块选项（`dir` / `storage` / `driver`）；默认本地存储 `uploads`
   * @returns 全局 DynamicModule（任意模块可注入 `FileService`）
   */
  static forRoot(options: FileModuleOptions = {}): DynamicModule {
    return {
      module: FileModule,
      global: true,
      providers: [
        { provide: FILE_MODULE_OPTIONS, useValue: options },
        { provide: FILE_STORAGE, useValue: resolveStorageDriver(options) },
        FileService,
      ],
      exports: [FileService],
    };
  }

  /**
   * 异步注册全局文件模块（配置来自 `ConfigService` 等可注入依赖）。
   *
   * @param options 异步选项：`imports` / `inject` / `useFactory`
   * @returns 全局 DynamicModule（任意模块可注入 `FileService`）
   */
  static forRootAsync(options: FileModuleAsyncOptions): DynamicModule {
    return {
      module: FileModule,
      global: true,
      imports: [...(options.imports ?? [])],
      providers: [
        {
          provide: FILE_MODULE_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) =>
            (await options.useFactory(...args)) as FileModuleOptions,
        },
        {
          provide: FILE_STORAGE,
          inject: [FILE_MODULE_OPTIONS],
          useFactory: (opts: FileModuleOptions) => resolveStorageDriver(opts),
        },
        FileService,
      ],
      exports: [FileService],
    };
  }
}
