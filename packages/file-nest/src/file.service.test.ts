import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from './file.service.js';

describe('FileService', () => {
  const storage = {
    write: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  };
  const options = { storage: 'local' };
  let service: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileService(storage as never, options);
  });

  it('save 写入存储并返回 StoredFile（含 sha256 与 key）', async () => {
    const input = {
      buffer: Buffer.from('%PDF-1.4'),
      ext: '.pdf',
      mime: 'application/pdf',
    };
    const file = await service.save(input);
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^.+\.pdf$/),
      input.buffer,
    );
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(file).toEqual({
      key: expect.stringMatching(/^.+\.pdf$/),
      ext: '.pdf',
      mime: 'application/pdf',
      size: input.buffer.length,
      hash: createHash('sha256').update(input.buffer).digest('hex'),
      storage: 'local',
    });
  });

  it('默认 storage 为 local', async () => {
    service = new FileService(storage as never, {});
    const file = await service.save({
      buffer: Buffer.from('x'),
      ext: '.txt',
      mime: 'text/plain',
    });
    expect(file.storage).toBe('local');
  });

  it('read 委托给存储并返回 Buffer', async () => {
    storage.read.mockResolvedValue(Buffer.from('raw'));
    const buf = await service.read('f1.pdf');
    expect(storage.read).toHaveBeenCalledWith('f1.pdf');
    expect(buf).toEqual(Buffer.from('raw'));
  });

  it('remove 委托给存储删除', async () => {
    await service.remove('f1.pdf');
    expect(storage.delete).toHaveBeenCalledWith('f1.pdf');
  });
});
