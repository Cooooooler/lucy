import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { describe, expect, it, vi } from 'vitest';
import { FILE_STORAGE } from './file.constants.js';
import { FileEntity } from './file.entity.js';
import { FileModule } from './file.module.js';
import { FileService } from './file.service.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';

describe('FileModule', () => {
  it('forRoot 提供默认 LocalStorageDriver 与 FileService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FileModule.forRoot({ dir: '/tmp/fs' })],
    })
      .overrideProvider(getRepositoryToken(FileEntity))
      .useValue({ create: (v: unknown) => v, save: (v: unknown) => v })
      .compile();
    const storage = moduleRef.get(FILE_STORAGE);
    expect(storage).toBeInstanceOf(LocalStorageDriver);
    const svc = moduleRef.get(FileService);
    expect(svc).toBeDefined();
  });

  it('forRootAsync 经 useFactory 解析配置', async () => {
    const fn = vi.fn(() => ({ dir: '/tmp/x', storage: 'local' }));
    const moduleRef = await Test.createTestingModule({
      imports: [FileModule.forRootAsync({ useFactory: fn })],
    })
      .overrideProvider(getRepositoryToken(FileEntity))
      .useValue({ create: (v: unknown) => v, save: (v: unknown) => v })
      .compile();
    expect(fn).toHaveBeenCalled();
    expect(moduleRef.get(FileService)).toBeDefined();
  });
});
