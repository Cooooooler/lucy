import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import {
  ModelProviderDefaultsDto,
  UpdateModelProviderDefaultsDto,
} from './dto/model-provider-defaults.dto.js';
import {
  ModelProvider,
  ModelProviderType,
} from './entities/model-provider.entity.js';
import { UserDefaultModel } from './entities/user-default-model.entity.js';

/** 契约里列出的全部模型类型（顺序即前端展示顺序） */
const MODEL_PROVIDER_TYPES = Object.values(ModelProviderType);

/**
 * 用户默认模型：按模型类型各存一条。
 *
 * 写入是**整体替换**语义：一次请求提交完整的类型映射，未提交的类型一律清除。
 * 这样前端只管提交表单全量值，不必关心后端残留的旧设置。
 */
@Injectable()
export class ModelProviderDefaultsService {
  constructor(
    @InjectRepository(UserDefaultModel)
    private readonly repo: Repository<UserDefaultModel>,
    @InjectRepository(ModelProvider)
    private readonly providers: Repository<ModelProvider>,
  ) {}

  /** 读取当前用户的默认模型；未设置的类型返回 null */
  async list(userId: string): Promise<ModelProviderDefaultsDto> {
    const rows = await this.repo.find({
      where: { ownerId: userId },
      relations: { modelProvider: true },
    });
    const byType = new Map<ModelProviderType, string>();
    for (const row of rows) {
      // modelProvider 由 FK CASCADE 保证存在；防御性判空避免脏数据把整份设置打崩
      if (row.modelProvider) {
        byType.set(row.modelProvider.type, row.modelProviderId);
      }
    }
    return {
      defaults: MODEL_PROVIDER_TYPES.map((type) => ({
        type,
        modelProviderId: byType.get(type) ?? null,
      })),
    };
  }

  /**
   * 整体替换默认模型设置。
   * @throws BadRequestException 所选模型不存在、不属于当前用户，或类型不匹配
   */
  async replace(
    userId: string,
    dto: UpdateModelProviderDefaultsDto,
  ): Promise<ModelProviderDefaultsDto> {
    // 同一类型重复提交时后者生效；空值表示清除
    const selected = new Map<ModelProviderType, string | null>();
    for (const item of dto.defaults) {
      selected.set(item.type, item.modelProviderId ?? null);
    }

    const ids = [
      ...new Set(
        [...selected.values()].filter((id): id is string => id !== null),
      ),
    ];
    const owned = ids.length
      ? await this.providers.find({
          where: { id: In(ids), ownerId: userId },
        })
      : [];
    const ownedById = new Map(owned.map((provider) => [provider.id, provider]));
    for (const [type, id] of selected) {
      if (id === null) continue;
      const provider = ownedById.get(id);
      if (!provider) {
        throw new BadRequestException('默认模型不存在或不属于当前用户');
      }
      if (provider.type !== type) {
        throw new BadRequestException('默认模型的类型与所设类型不一致');
      }
    }

    const rows = [...selected]
      .filter(([, id]) => id !== null)
      .map(([, modelProviderId]) => ({
        ownerId: userId,
        modelProviderId: modelProviderId as string,
      }));

    await this.repo.manager.transaction(async (manager) => {
      await manager.delete(UserDefaultModel, { ownerId: userId });
      if (rows.length > 0) {
        await manager.save(UserDefaultModel, rows);
      }
    });

    return this.list(userId);
  }
}
