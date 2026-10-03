import { ChatAnthropic } from '@langchain/anthropic';
import type { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import {
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
  type ModelProvider,
} from './entities/model-provider.entity.js';

/**
 * 类型/供应商组合在当前 LangChain 统一 SDK 下没有对应客户端：
 * - speech2text / tts 三家都没有统一类
 * - moderation 只有 OpenAI 提供（`ChatOpenAI.moderateContent`）
 * - text-embedding 只有 OpenAI / Ollama 提供，Anthropic 无 embeddings 接口
 */
export class UnsupportedModelTypeError extends Error {
  constructor(
    readonly type: ModelProviderType,
    readonly vendor?: ModelProviderVendor,
  ) {
    super(
      vendor
        ? `供应商 ${vendor} 下的模型类型 ${type} 暂不支持 LangChain 统一客户端`
        : `模型类型 ${type} 暂不支持 LangChain 统一客户端`,
    );
    this.name = 'UnsupportedModelTypeError';
  }
}

/**
 * 按模型配置构造 LangChain 统一客户端的工厂（按 `vendor` 分派）。
 *
 * 覆盖矩阵（统一 SDK 的实际能力）：
 * - LLM → OpenAI `ChatOpenAI` / Anthropic `ChatAnthropic` / Ollama `ChatOllama`
 * - Moderation → 仅 OpenAI（`ChatOpenAI.moderateContent`），其余供应商由 `assertSupported` 拦下
 * - Text Embedding → OpenAI `OpenAIEmbeddings` / Ollama `OllamaEmbeddings`，Anthropic 不支持
 * - Speech2Text / TTS → 无对应类，抛 `UnsupportedModelTypeError`
 *
 * `maxRetries: 0`：连接测试要的是「现在通不通」，默认的 2 次重试会把失败响应拖长数倍，
 * 也让测试耗时不可预期。协议只在 OpenAI 生效（responses → `useResponsesApi`）。
 * ollama 通常免鉴权，未配置 Key 时不带鉴权头；若配置了（如受保护的远端实例）则带 Bearer。
 */
@Injectable()
export class ModelClientFactory {
  constructor(private readonly cipher: ApiKeyCipher) {}

  /** 构造对话模型客户端（LLM 用；Moderation 走 buildOpenAiChat） */
  buildChat(provider: ModelProvider): BaseChatModel {
    switch (provider.vendor) {
      case ModelProviderVendor.Anthropic:
        return new ChatAnthropic({
          model: provider.name,
          apiKey: this.requireApiKey(provider),
          anthropicApiUrl: provider.baseUrl,
          maxRetries: 0,
        });
      case ModelProviderVendor.Ollama:
        return new ChatOllama({
          model: provider.name,
          baseUrl: provider.baseUrl,
          headers: this.ollamaHeaders(provider),
        });
      default:
        return this.buildOpenAiChat(provider);
    }
  }

  /** 构造 OpenAI 对话客户端（Moderation 的 `moderateContent` 只在此类上提供） */
  buildOpenAiChat(provider: ModelProvider): ChatOpenAI {
    return new ChatOpenAI({
      model: provider.name,
      apiKey: this.requireApiKey(provider),
      configuration: { baseURL: provider.baseUrl },
      useResponsesApi: provider.protocol === ModelProviderProtocol.Responses,
      maxRetries: 0,
    });
  }

  /** 构造向量模型客户端（Anthropic 无 embeddings 接口，故仅 OpenAI / Ollama） */
  buildEmbeddings(provider: ModelProvider): Embeddings {
    if (provider.vendor === ModelProviderVendor.Ollama) {
      return new OllamaEmbeddings({
        model: provider.name,
        baseUrl: provider.baseUrl,
        headers: this.ollamaHeaders(provider),
        maxRetries: 0,
      });
    }
    return new OpenAIEmbeddings({
      model: provider.name,
      apiKey: this.requireApiKey(provider),
      configuration: { baseURL: provider.baseUrl },
      // Embeddings 走基类的 AsyncCaller，默认重试 6 次（指数退避）；OpenAI client 自带的
      // maxRetries 管不到这一层，不显式归零则连接测试超时返回后仍会在后台退避重试
      maxRetries: 0,
    });
  }

  /** 类型 + 供应商组合是否可构造客户端；不可用时抛 `UnsupportedModelTypeError` */
  assertSupported(type: ModelProviderType, vendor: ModelProviderVendor): void {
    if (
      type === ModelProviderType.Speech2Text ||
      type === ModelProviderType.Tts
    ) {
      throw new UnsupportedModelTypeError(type);
    }
    if (
      type === ModelProviderType.Moderation &&
      vendor !== ModelProviderVendor.OpenAI
    ) {
      throw new UnsupportedModelTypeError(type, vendor);
    }
    if (
      type === ModelProviderType.TextEmbedding &&
      vendor === ModelProviderVendor.Anthropic
    ) {
      throw new UnsupportedModelTypeError(type, vendor);
    }
  }

  /** 解密 API Key；缺失时给出明确错误（正常经 DTO/服务层校验不应发生） */
  private requireApiKey(provider: ModelProvider): string {
    const key = this.apiKeyOf(provider);
    if (!key) throw new Error(`模型 ${provider.name} 未配置 API Key`);
    return key;
  }

  /** ollama 若配置了 Key 则带上 Bearer 头，否则不带（本地免鉴权） */
  private ollamaHeaders(
    provider: ModelProvider,
  ): Record<string, string> | undefined {
    const key = this.apiKeyOf(provider);
    return key ? { Authorization: `Bearer ${key}` } : undefined;
  }

  /** 空串表示未配置（ollama 免鉴权），此时不解密 */
  private apiKeyOf(provider: ModelProvider): string {
    return provider.apiKeyEncrypted
      ? this.cipher.decrypt(provider.apiKeyEncrypted)
      : '';
  }
}
