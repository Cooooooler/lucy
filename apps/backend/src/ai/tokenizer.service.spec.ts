import { ConfigService } from '@nestjs/config';
import { TokenizerService } from './tokenizer.service.js';

describe('TokenizerService', () => {
  const config = new ConfigService({
    OLLAMA_BASE_URL: 'http://localhost:11434',
  });

  afterEach(() => vi.unstubAllGlobals());

  it('调用 /api/tokenize 并返回 count', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => ({ count: 42 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await expect(svc.countTokens('你好', 'qwen')).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tokenize',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('相同 (model, text) 命中缓存不再请求', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => ({ count: 5 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await svc.countTokens('abc', 'qwen');
    await svc.countTokens('abc', 'qwen');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('请求失败时按字符数估算兜底', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const svc = new TokenizerService(config);
    await expect(svc.countTokens('你好世界', 'qwen')).resolves.toBe(2);
  });

  it('不同 model 缓存隔离', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => ({ count: 3 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await svc.countTokens('x', 'a');
    await svc.countTokens('x', 'b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
