import { PasswordService } from './password.service';

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
});
