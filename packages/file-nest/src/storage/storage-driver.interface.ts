/** 存储驱动：按 key（相对路径）读写删除对象。key 为相对路径；通常为单层文件名（FileService 约定），驱动不强制单层。 */
export interface StorageDriver {
  /** 写入对象（同 key 覆盖）；返回 Promise 时调用方会等待落盘完成 */
  write(key: string, data: Buffer): Promise<void> | void;
  /** 读取对象内容 */
  read(key: string): Promise<Buffer>;
  /** 删除对象；实现可对不存在的 key 静默 */
  delete(key: string): Promise<void> | void;
}
