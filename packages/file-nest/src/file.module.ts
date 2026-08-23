import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import { FileEntity } from './file.entity.js';
import { FileService } from './file.service.js';
import type { FileModuleAsyncOptions, FileModuleOptions } from './options.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

/** 解析存储驱动：优先注入的 driver，否则用 LocalStorageDriver(dir) */
export function resolveStorageDriver(opts: FileModuleOptions): StorageDriver {
  return opts.driver ?? new LocalStorageDriver({ dir: opts.dir });
}

@Module({})
export class FileModule {
  static forRoot(options: FileModuleOptions = {}): DynamicModule {
    return {
      module: FileModule,
      global: true,
      imports: [TypeOrmModule.forFeature([FileEntity])],
      providers: [
        { provide: FILE_MODULE_OPTIONS, useValue: options },
        { provide: FILE_STORAGE, useValue: resolveStorageDriver(options) },
        FileService,
      ],
      exports: [FileService],
    };
  }

  static forRootAsync(options: FileModuleAsyncOptions): DynamicModule {
    return {
      module: FileModule,
      global: true,
      imports: [
        TypeOrmModule.forFeature([FileEntity]),
        ...(options.imports ?? []),
      ],
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
