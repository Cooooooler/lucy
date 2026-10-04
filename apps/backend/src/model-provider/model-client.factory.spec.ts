import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { makeModelProvider } from '../test/model-provider.fixtures.js';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import {
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from './entities/model-provider.entity.js';
import {
  ModelClientFactory,
  UnsupportedModelTypeError,
} from './model-client.factory.js';

/** 用真实 cipher（密钥固定）构造工厂，验证解密路径与客户端参数 */
const config = new ConfigService({
  MODEL_PROVIDER_SECRET_KEY: 'test-model-provider-secret-32-chars-long',
  AI_OUTPUT_MAX_TOKENS: 32768,
});
const cipher = new ApiKeyCipher(config);
const factory = new ModelClientFactory(cipher, config);

describe('ModelClientFactory', () => {
  const provider = makeModelProvider({
    apiKeyEncrypted: cipher.encrypt('sk-secret-key'),
  });

  it('OpenAI LLM + chat-completions → useResponsesApi=false', () => {
    const client = factory.buildOpenAiChat(provider);
    expect(client.model).toBe('gpt-4o-mini');
    expect(client.useResponsesApi).toBe(false);
  });

  it('OpenAI LLM + responses → useResponsesApi=true', () => {
    const client = factory.buildOpenAiChat({
      ...provider,
      protocol: ModelProviderProtocol.Responses,
    });
    expect(client.useResponsesApi).toBe(true);
  });

  it('Anthropic LLM → ChatAnthropic', () => {
    const client = factory.buildChat({
      ...provider,
      vendor: ModelProviderVendor.Anthropic,
    });
    expect(client).toBeInstanceOf(ChatAnthropic);
    expect((client as ChatAnthropic).model).toBe('gpt-4o-mini');
  });

  it('Ollama LLM → ChatOllama，无 Key 时不带鉴权头', () => {
    const client = factory.buildChat({
      ...provider,
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
    });
    expect(client).toBeInstanceOf(ChatOllama);
    expect((client as ChatOllama).model).toBe('gpt-4o-mini');
  });

  it('Ollama buildChat 透传 think / numPredict', () => {
    const client = factory.buildChat(
      {
        ...provider,
        vendor: ModelProviderVendor.Ollama,
        apiKeyEncrypted: '',
      },
      { think: true, numPredict: 4096 },
    ) as ChatOllama;
    expect(client.think).toBe(true);
    expect(client.numPredict).toBe(4096);
  });

  it('OpenAI buildEmbeddings → OpenAIEmbeddings', () => {
    expect(factory.buildEmbeddings(provider)).toBeInstanceOf(OpenAIEmbeddings);
  });

  it('Ollama buildEmbeddings → OllamaEmbeddings', () => {
    expect(
      factory.buildEmbeddings({
        ...provider,
        vendor: ModelProviderVendor.Ollama,
        apiKeyEncrypted: '',
      }),
    ).toBeInstanceOf(OllamaEmbeddings);
  });

  it('assertSupported 按类型 × 供应商放行/拒绝', () => {
    const { Llm, TextEmbedding, Moderation, Speech2Text, Tts } =
      ModelProviderType;
    const { OpenAI, Anthropic, Ollama } = ModelProviderVendor;

    // 三家都支持 LLM
    expect(() => factory.assertSupported(Llm, OpenAI)).not.toThrow();
    expect(() => factory.assertSupported(Llm, Anthropic)).not.toThrow();
    expect(() => factory.assertSupported(Llm, Ollama)).not.toThrow();
    // embeddings 仅 OpenAI / Ollama
    expect(() => factory.assertSupported(TextEmbedding, OpenAI)).not.toThrow();
    expect(() => factory.assertSupported(TextEmbedding, Ollama)).not.toThrow();
    expect(() => factory.assertSupported(TextEmbedding, Anthropic)).toThrow(
      UnsupportedModelTypeError,
    );
    // moderation 仅 OpenAI
    expect(() => factory.assertSupported(Moderation, OpenAI)).not.toThrow();
    expect(() => factory.assertSupported(Moderation, Anthropic)).toThrow(
      UnsupportedModelTypeError,
    );
    expect(() => factory.assertSupported(Moderation, Ollama)).toThrow(
      UnsupportedModelTypeError,
    );
    // 三家都不支持语音
    expect(() => factory.assertSupported(Speech2Text, OpenAI)).toThrow(
      UnsupportedModelTypeError,
    );
    expect(() => factory.assertSupported(Tts, Ollama)).toThrow(
      UnsupportedModelTypeError,
    );
  });

  it('ollama 配置了 Key 仍可构造（带鉴权头路径）', () => {
    // apiKeyEncrypted 为真 → 走解密 + Bearer 头分支
    expect(() =>
      factory.buildChat({
        ...provider,
        vendor: ModelProviderVendor.Ollama,
      }),
    ).not.toThrow();
  });

  it('需要 Key 的供应商缺 Key 时构造客户端抛错', () => {
    const noKey = { ...provider, apiKeyEncrypted: '' };
    expect(() => factory.buildOpenAiChat(noKey)).toThrow(/未配置 API Key/);
    expect(() =>
      factory.buildChat({ ...noKey, vendor: ModelProviderVendor.Anthropic }),
    ).toThrow(/未配置 API Key/);
  });

  it('Ollama 未显式指定 numPredict 时取 AI_OUTPUT_MAX_TOKENS 默认', () => {
    const client = factory.buildChat({
      ...provider,
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
    }) as ChatOllama;
    expect(client.numPredict).toBe(32768);
  });

  it('AI_OUTPUT_MAX_TOKENS 非法（0）时回退 32768', () => {
    const badConfig = new ConfigService({
      MODEL_PROVIDER_SECRET_KEY: 'test-model-provider-secret-32-chars-long',
      AI_OUTPUT_MAX_TOKENS: 0,
    });
    const badFactory = new ModelClientFactory(
      new ApiKeyCipher(badConfig),
      badConfig,
    );
    const client = badFactory.buildChat({
      ...provider,
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
    }) as ChatOllama;
    expect(client.numPredict).toBe(32768);
  });

  it('numPredict 不同则缓存键不同（默认与覆盖值不互相命中）', () => {
    const base = {
      ...provider,
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
    };
    const a = factory.buildChat(base, { numPredict: 4096 });
    expect(factory.buildChat(base, { numPredict: 4096 })).toBe(a);
    expect(factory.buildChat(base, { numPredict: 8192 })).not.toBe(a);
    expect(factory.buildChat(base)).not.toBe(a);
  });

  it('同配置复用缓存实例；配置变化后重建', () => {
    const a = factory.buildChat(provider);
    expect(factory.buildChat(provider)).toBe(a);
    expect(factory.buildChat({ ...provider, name: 'gpt-4o' })).not.toBe(a);
  });
});
