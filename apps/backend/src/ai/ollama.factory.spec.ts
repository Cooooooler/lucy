import { ConfigService } from '@nestjs/config';
import { OllamaFactory } from './ollama.factory.js';

describe('OllamaFactory', () => {
  const config = new ConfigService({
    OLLAMA_MODEL: 'default-model',
    OLLAMA_BASE_URL: 'http://localhost:11434',
  });

  it('同一 model 返回同一实例（缓存）', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient('qwen')).toBe(factory.getClient('qwen'));
  });

  it('不同 model 返回不同实例', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient('a')).not.toBe(factory.getClient('b'));
  });

  it('未传 model 时使用配置默认模型', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient()).toBe(factory.getClient('default-model'));
  });

  it('超过缓存上限后淘汰最旧条目', () => {
    const factory = new OllamaFactory(config);
    const m0 = factory.getClient('m0');
    // 再塞满 50 个（容量上限 50，m0 为最早条目被淘汰）
    for (let i = 1; i <= 50; i++) factory.getClient(`m${i}`);
    // m0 已被淘汰，重新获取会创建新实例
    expect(factory.getClient('m0')).not.toBe(m0);
  });
});
