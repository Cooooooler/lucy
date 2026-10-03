import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { escapeLikePattern } from '../common/like-pattern.js';
import { KeysetPaginator } from '../common/pagination/keyset-paginator.js';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import { assertBaseUrlHostAllowed } from './base-url-guard.js';
import { CreateModelProviderDto } from './dto/create-model-provider.dto.js';
import { ModelProviderListQueryDto } from './dto/model-provider-list-query.dto.js';
import type {
  ModelProviderItemDto,
  ModelProviderListResultDto,
} from './dto/model-provider-list-result.dto.js';
import { UpdateModelProviderDto } from './dto/update-model-provider.dto.js';
import {
  ModelProvider,
  ModelProviderProtocol,
  ModelProviderVendor,
} from './entities/model-provider.entity.js';
import { resolveOwnedModelProvider } from './model-provider-access.js';
import { toModelProviderItem } from './model-provider.mapper.js';

/**
 * 模型供应商领域服务：属主私有的 CRUD（create/list/get/update/remove）。
 *
 * 不提供公开/共享分支——凭证按属主隔离，所有查询都把 owner 写进 where。API Key 只在此
 * 加密入库；解密只发生在构造 LangChain 客户端时（见 `ModelClientFactory`）。
 */
@Injectable()
export class ModelProviderService {
  constructor(
    private readonly logger: AppLogger,
    @InjectRepository(ModelProvider)
    private readonly repo: Repository<ModelProvider>,
    private readonly paginator: KeysetPaginator,
    private readonly cipher: ApiKeyCipher,
  ) {}

  /**
   * 创建一个模型供应商。
   * @param userId 属主用户 ID
   * @param dto 创建参数（API Key 明文传入，此处加密存储）
   */
  async create(
    userId: string,
    dto: CreateModelProviderDto,
  ): Promise<ModelProviderItemDto> {
    const apiKey = dto.apiKey?.trim() ?? '';
    this.assertApiKeyForVendor(dto.vendor, apiKey.length > 0);
    assertBaseUrlHostAllowed(dto.baseUrl);
    const provider = await this.repo.save({
      ownerId: userId,
      name: dto.name,
      type: dto.type,
      vendor: dto.vendor,
      baseUrl: dto.baseUrl,
      protocol: dto.protocol ?? ModelProviderProtocol.ChatCompletions,
      contextLength: dto.contextLength,
      apiKeyEncrypted: apiKey ? this.cipher.encrypt(apiKey) : '',
      apiKeyLast4: apiKey ? this.cipher.last4(apiKey) : '',
    });
    this.logger.log(
      `model provider create id=${provider.id}`,
      ModelProviderService.name,
    );
    return toModelProviderItem(provider);
  }

  /**
   * 游标分页查询当前用户的模型列表。
   * 按**不可变**的 (created_at, id) 降序做 keyset 分页；可按类型/名称关键字过滤。
   */
  async list(
    userId: string,
    query: ModelProviderListQueryDto,
  ): Promise<ModelProviderListResultDto> {
    const qb = this.repo
      .createQueryBuilder('m')
      // 显式列投影：把 api_key_encrypted（text，凭证材料）挡在 SELECT 之外——列表只需
      // 契约字段 + 脱敏用的 apiKeyLast4，没必要每页把密文拉回内存再由 mapper 丢弃
      .select([
        'm.id',
        'm.ownerId',
        'm.name',
        'm.type',
        'm.vendor',
        'm.baseUrl',
        'm.protocol',
        'm.contextLength',
        'm.apiKeyLast4',
        'm.createdAt',
        'm.updatedAt',
      ])
      .where('m.ownerId = :uid', { uid: userId });
    if (query.type) {
      qb.andWhere('m.type = :type', { type: query.type });
    }
    if (query.name) {
      qb.andWhere('m.name ILIKE :name', {
        name: `%${escapeLikePattern(query.name)}%`,
      });
    }
    const page = await this.paginator.fetchPage(qb, query.cursor, query.limit);
    return {
      list: page.list.map(toModelProviderItem),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * 获取模型详情。
   * @throws NotFoundException 不存在或非属主
   */
  async get(userId: string, id: string): Promise<ModelProviderItemDto> {
    return toModelProviderItem(
      await resolveOwnedModelProvider(this.repo, id, userId),
    );
  }

  /**
   * 更新模型；只更新 DTO 中显式提供的字段。
   * `apiKey` 省略即保留原 Key；传值则重新加密覆盖。
   * @throws NotFoundException 不存在或非属主
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateModelProviderDto,
  ): Promise<ModelProviderItemDto> {
    const provider = await resolveOwnedModelProvider(this.repo, id, userId);
    if (dto.name !== undefined) provider.name = dto.name;
    if (dto.type !== undefined) provider.type = dto.type;
    if (dto.vendor !== undefined) provider.vendor = dto.vendor;
    if (dto.baseUrl !== undefined) {
      assertBaseUrlHostAllowed(dto.baseUrl);
      provider.baseUrl = dto.baseUrl;
    }
    if (dto.protocol !== undefined) provider.protocol = dto.protocol;
    if (dto.contextLength !== undefined) {
      provider.contextLength = dto.contextLength;
    }
    if (dto.apiKey !== undefined) {
      const apiKey = dto.apiKey.trim();
      provider.apiKeyEncrypted = apiKey ? this.cipher.encrypt(apiKey) : '';
      provider.apiKeyLast4 = apiKey ? this.cipher.last4(apiKey) : '';
    }
    // 换厂商（如 ollama → openai）而未补 Key 时，落库前拦下，避免存出永远调不通的配置
    this.assertApiKeyForVendor(
      provider.vendor,
      provider.apiKeyEncrypted.length > 0,
    );
    const saved = await this.repo.save(provider);
    this.logger.log(
      `model provider update id=${id}`,
      ModelProviderService.name,
    );
    return toModelProviderItem(saved);
  }

  /**
   * 删除模型（按属主删除，非属主/不存在一律 404）。
   * @throws NotFoundException 不存在或非属主
   */
  async remove(userId: string, id: string): Promise<null> {
    const result = await this.repo.delete({ id, ownerId: userId });
    if (!result.affected) throw new NotFoundException('模型不存在');
    this.logger.log(
      `model provider remove id=${id}`,
      ModelProviderService.name,
    );
    return null;
  }

  /**
   * 供应商与 API Key 的必填关系：ollama 免鉴权可省略，其余厂商必须有 Key。
   * @throws BadRequestException 需要 Key 却未提供
   */
  private assertApiKeyForVendor(vendor: ModelProviderVendor, hasKey: boolean) {
    if (vendor !== ModelProviderVendor.Ollama && !hasKey) {
      throw new BadRequestException('该供应商必须提供 API Key');
    }
  }
}
