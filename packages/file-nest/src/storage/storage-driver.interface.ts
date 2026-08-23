/** 存储驱动：按 key（相对路径）读写删除对象。key 为单层文件名（如 `uuid.pdf`）。 */
export interface StorageDriver {
  write(key: string, data: Buffer): Promise<void> | void;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void> | void;
}
