import { ChatAnthropic } from '@langchain/anthropic';
import type { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/** 对话客户端构造选项：仅对支持对应能力的供应商生效 */
export interface ChatClientOptions {
  /** 仅 Ollama：是否开启深度思考（think）。 */
  think?: boolean;
  /** 仅 Ollama：生成输出上限（num_predict）。 */
  numPredict?: number;
}

/**
 * 生成输出上限（token）的单一解析：`AI_OUTPUT_MAX_TOKENS`，非法/缺失（0/负/小数/NaN/Infinity）
 * 回退 32768（对齐 .env.example）。既作为工厂 numPredict 的默认，也供上下文预算预留复用，
 * 确保「预留」与「实际 numPredict」同源、不漂移。
 */
export function resolveOutputMaxTokens(config: ConfigService): number {
  const parsed = Number(config.get('AI_OUTPUT_MAX_TOKENS', 32768));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 32768;
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
  // 对话客户端缓存：同一会话每条消息、每次标题生成都复用同一实例，避免重复 new 底层 SDK/连接。
  // 键取「影响客户端构造的配置签名」（见 chatCacheKey），任一字段或密文 Key 变化即视为新客户端，
  // 不会命中旧凭证/旧地址；provider 删除后条目由容量淘汰兜底。
  private readonly chatCache = new Map<string, BaseChatModel>();
  private readonly maxChatCacheEntries = 50;

  constructor(
    private readonly cipher: ApiKeyCipher,
    private readonly config: ConfigService,
  ) {}

  /** 构造对话模型客户端（LLM 用；Moderation 走 buildOpenAiChat） */
  buildChat(
    provider: ModelProvider,
    options: ChatClientOptions = {},
  ): BaseChatModel {
    const key = this.chatCacheKey(provider, options);
    const cached = this.chatCache.get(key);
    if (cached) return cached;
    const client = this.createChat(provider, options);
    this.chatCache.set(key, client);
    // 超限淘汰最旧条目（Map 保持插入序）
    if (this.chatCache.size > this.maxChatCacheEntries) {
      const oldest = this.chatCache.keys().next().value;
      if (oldest !== undefined) this.chatCache.delete(oldest);
    }
    return client;
  }

  /**
   * 缓存键：影响客户端构造的字段签名 + think + numPredict，任一变化都重建
   * （含密文 Key，避免命中旧凭证；含 numPredict，避免覆盖值命中默认值实例）。
   */
  private chatCacheKey(
    provider: ModelProvider,
    options: ChatClientOptions,
  ): string {
    return [
      provider.id,
      provider.vendor,
      provider.name,
      provider.baseUrl,
      provider.protocol,
      provider.apiKeyEncrypted,
      options.think === true,
      options.numPredict ?? 'default',
    ].join('|');
  }

  private createChat(
    provider: ModelProvider,
    options: ChatClientOptions,
  ): BaseChatModel {
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
          // think 是实例级参数；numPredict 默认取 AI_OUTPUT_MAX_TOKENS，调用点可按需覆盖
          think: options.think,
          numPredict: options.numPredict ?? resolveOutputMaxTokens(this.config),
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
