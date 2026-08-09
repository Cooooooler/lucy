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

  it('超过容量上限时淘汰最旧条目', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => ({ count: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(
      new ConfigService({ AI_TOKENIZER_CACHE_SIZE: 3 }),
    );
    await svc.countTokens('a', 'qwen');
    await svc.countTokens('b', 'qwen');
    await svc.countTokens('c', 'qwen');
    await svc.countTokens('d', 'qwen'); // 超限，淘汰最旧 'a'
    // 重新请求 'a'：已被淘汰，应再次请求 tokenize
    await svc.countTokens('a', 'qwen');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
