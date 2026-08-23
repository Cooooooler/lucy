import { describe, expect, it } from 'vitest';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import * as pkg from './index.js';

describe('file-nest exports', () => {
  it('导出核心符号', () => {
    expect(pkg.FileModule).toBeDefined();
    expect(pkg.FileService).toBeDefined();
    expect(pkg.LocalStorageDriver).toBeDefined();
    expect(pkg.FILE_STORAGE).toBe(FILE_STORAGE);
    expect(pkg.FILE_MODULE_OPTIONS).toBe(FILE_MODULE_OPTIONS);
    expect(pkg.FILE_NEST_VERSION).toBe('0.1.0');
  });
});
