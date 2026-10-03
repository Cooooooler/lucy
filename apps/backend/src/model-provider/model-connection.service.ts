import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import type { ModelProviderTestResultDto } from './dto/model-provider-test-result.dto.js';
import {
  ModelProvider,
  ModelProviderType,
} from './entities/model-provider.entity.js';
import {
  ModelClientFactory,
  UnsupportedModelTypeError,
} from './model-client.factory.js';
import { resolveOwnedModelProvider } from './model-provider-access.js';

/** 探针超时（由 `withTimeout` 抛出，用于与真实错误区分以给出「连接超时」文案） */
class ModelTestTimeoutError extends Error {
  constructor() {
    super('模型连接测试超时');
    this.name = 'ModelTestTimeoutError';
  }
}

/** 连接测试默认超时（毫秒），可被 `MODEL_TEST_TIMEOUT_MS` 覆盖 */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 模型「连接测试」服务：按配置构造 LangChain 客户端并做一次最小探针调用。
 *
 * 结果始终以 200 返回（`ok` 表达结论），失败文案面向用户、不泄漏主机/端口/堆栈；
 * 原始错误只进日志。
 */
@Injectable()
export class ModelConnectionService {
  constructor(
    @InjectRepository(ModelProvider)
    private readonly repo: Repository<ModelProvider>,
    private readonly factory: ModelClientFactory,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 测试指定模型是否可连通，返回面向用户的结论 */
  async test(userId: string, id: string): Promise<ModelProviderTestResultDto> {
    const provider = await resolveOwnedModelProvider(this.repo, id, userId);

    // 无统一客户端的类型/供应商组合：不发起调用，直接给出可解释的结论
    try {
      this.factory.assertSupported(provider.type, provider.vendor);
    } catch (error) {
      if (error instanceof UnsupportedModelTypeError) {
        return {
          ok: false,
          message: '该模型类型暂不支持连通性测试',
          latencyMs: null,
          detail: null,
        };
      }
      throw error;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number(
      this.config.get('MODEL_TEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    );
    try {
      const detail = await this.withTimeout(
        this.probe(provider, controller.signal),
        timeoutMs,
        controller,
      );
      return {
        ok: true,
        message: '连接成功',
        latencyMs: Date.now() - startedAt,
        detail,
      };
    } catch (error) {
      this.logger.warn(
        `model test failed id=${id} type=${provider.type} vendor=${provider.vendor}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        ModelConnectionService.name,
      );
      return {
        ok: false,
        message: this.friendlyMessage(error),
        latencyMs: Date.now() - startedAt,
        detail: null,
      };
    }
  }

  /** 按类型发起最小探针，返回展示用的补充信息 */
  private async probe(
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<string> {
    switch (provider.type) {
      case ModelProviderType.Llm: {
        const chat = this.factory.buildChat(provider);
        const result = await chat.invoke('你好', { signal });
        const text = typeof result.content === 'string' ? result.content : '';
        return text ? `回复：${text.slice(0, 40)}` : '已连通';
      }
      case ModelProviderType.Moderation: {
        const chat = this.factory.buildOpenAiChat(provider);
        const result = await chat.moderateContent('你好', {
          options: { signal },
        });
        return `审核返回 ${result.results.length} 条结果`;
      }
      case ModelProviderType.TextEmbedding: {
        const embeddings = this.factory.buildEmbeddings(provider);
        // 该版本 `Embeddings` 未实现 Runnable，embedQuery 不接受 signal；
        // 超时由 withTimeout 的竞速兜底（不会取消底层请求，但不再阻塞请求线程）
        const vector = await embeddings.embedQuery('你好');
        return `向量维度 ${vector.length}`;
      }
      default:
        // assertSupported 已拦截 speech2text/tts；这里只做类型收窄兜底
        throw new UnsupportedModelTypeError(provider.type);
    }
  }

  /** 让探针与超时竞速；超时则 abort 并抛 `ModelTestTimeoutError` */
  private async withTimeout<T>(
    task: Promise<T>,
    ms: number,
    controller: AbortController,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ModelTestTimeoutError());
      }, ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      clearTimeout(timer);
      // 竞速落败的探针可能稍后拒绝，吞掉避免 unhandled rejection
      task.catch(() => {});
    }
  }

  /** 把底层错误归一为面向用户的文案（不回显基础设施细节） */
  private friendlyMessage(error: unknown): string {
    if (error instanceof ModelTestTimeoutError) return '连接超时';
    if (error instanceof UnsupportedModelTypeError) {
      return '该模型类型暂不支持连通性测试';
    }
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) return 'API Key 无效或无权限';
    if (status === 404) return '接口不存在，请检查 Base URL 与协议';
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : '';
    if (
      /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|fetch failed|network/i.test(
        `${name} ${message}`,
      )
    ) {
      return '无法连接到 API Base URL';
    }
    return '连接失败，请检查配置';
  }
}
