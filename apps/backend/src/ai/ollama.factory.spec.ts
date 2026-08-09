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
});
