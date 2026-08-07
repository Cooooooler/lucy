import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hash 后可 verify 通过', async () => {
    const hash = await service.hash('P@ssw0rd!');
    await expect(service.verify('P@ssw0rd!', hash)).resolves.toBe(true);
  });

  it('错误密码 verify 失败', async () => {
    const hash = await service.hash('P@ssw0rd!');
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });

  it('hash 格式含参数前缀', async () => {
    const hash = await service.hash('P@ssw0rd!');
    expect(hash.startsWith('scrypt:16384:8:1:')).toBe(true);
  });

  it('非法格式返回 false', async () => {
    await expect(service.verify('x', 'not-a-hash')).resolves.toBe(false);
  });

  it('畸形存储串（空盐空哈希）verify 为 false', async () => {
    await expect(service.verify('any', 'scrypt:16384:8:1::')).resolves.toBe(
      false,
    );
  });

  it('非数值参数 verify 为 false 而非抛错', async () => {
    await expect(
      service.verify('any', 'scrypt:abc:8:1:eA==:eA=='),
    ).resolves.toBe(false);
  });
});
