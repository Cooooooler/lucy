import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEntity } from './file.entity.js';
import { FileService, type SaveFileInput } from './file.service.js';

describe('FileService', () => {
  const repo = {
    create: vi.fn((x) => x),
    save: vi.fn(),
    findOneBy: vi.fn(),
    delete: vi.fn(),
  };
  const storage = {
    write: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  };
  const options = { storage: 'local' };
  let service: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileService(repo as never, storage as never, options);
  });

  const input: SaveFileInput = {
    ownerId: 'u1',
    originalName: 'a.pdf',
    ext: '.pdf',
    mime: 'application/pdf',
    size: 8,
    buffer: Buffer.from('%PDF-1.4'),
  };

  it('save 写入存储并落元数据（含 sha256 与 key）', async () => {
    repo.save.mockResolvedValue(Object.assign(new FileEntity(), { id: 'f1' }));
    const file = await service.save(input);
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^.+\.pdf$/),
      input.buffer,
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        originalName: 'a.pdf',
        ext: '.pdf',
        key: expect.any(String),
        hash: createHash('sha256').update(input.buffer).digest('hex'),
        storage: 'local',
      }),
    );
    expect(file.id).toBe('f1');
  });

  it('read 委托给存储并返回 Buffer', async () => {
    storage.read.mockResolvedValue(Buffer.from('raw'));
    const buf = await service.read({ key: 'f1.pdf' } as FileEntity);
    expect(storage.read).toHaveBeenCalledWith('f1.pdf');
    expect(buf).toEqual(Buffer.from('raw'));
  });

  it('remove 删除存储与元数据', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.remove({ id: 'f1', key: 'f1.pdf' } as FileEntity);
    expect(storage.delete).toHaveBeenCalledWith('f1.pdf');
    expect(repo.delete).toHaveBeenCalledWith({ id: 'f1' });
  });

  it('findById 返回实体或 null', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(service.findById('nope')).resolves.toBeNull();
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'nope' });
  });
});
