export { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
export { FileModule, resolveStorageDriver } from './file.module.js';
export { FileService } from './file.service.js';
export type { StoredFile } from './file.service.js';
export type { FileModuleAsyncOptions, FileModuleOptions } from './options.js';
export { LocalStorageDriver } from './storage/local-storage.driver.js';
export type { LocalStorageDriverConfig } from './storage/local-storage.driver.js';
export type { StorageDriver } from './storage/storage-driver.interface.js';

export const FILE_NEST_VERSION = '0.1.0';
