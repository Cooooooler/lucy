import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type EntityManager, type Repository } from 'typeorm';
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
  ) {}

  /**
   * 清除指向某个模型的默认设置。
   *
   * 类型由关联模型派生：模型改类型后，这条默认项在旧类型下已失效。清理逻辑收敛在默认
   * 模型领域内，任何改动模型类型的入口都复用同一处条件。`manager` 由调用方的写事务
   * 传入，保证类型变更与清理同生共死。
   */
  async clearForProvider(
    manager: EntityManager,
    ownerId: string,
    modelProviderId: string,
  ): Promise<void> {
    await manager.delete(UserDefaultModel, { ownerId, modelProviderId });
  }

  /** 读取当前用户的默认模型；未设置的类型返回 null */
  async list(userId: string): Promise<ModelProviderDefaultsDto> {
    const rows = await this.repo.find({
      // 只取派生类型所需的列：关联模型若整行取回会带上 api_key_encrypted（凭证材料），
      // 默认模型设置完全用不到，没必要把它拉进内存
      select: {
        modelProviderId: true,
        modelProvider: { id: true, type: true },
      },
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
    const rows = [...selected]
      .filter(([, id]) => id !== null)
      .map(([, modelProviderId]) => ({
        ownerId: userId,
        modelProviderId: modelProviderId as string,
      }));

    await this.repo.manager.transaction(async (manager) => {
      // 同一用户的默认设置写入串行化：两次并发 PUT 的「按属主全删 + 重插」若交错，
      // 轻则唯一索引冲突冒成 500，重则两条同类型默认项同时提交、list() 静默丢弃一条。
      // 事务级 advisory lock 随提交/回滚自动释放，且不像锁 users 行那样阻塞无关的用户写入。
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `user-default-models:${userId}`,
      ]);
      // 校验与写入放在同一事务：先查后写若跨事务，校验通过后模型可能被删/改类型，
      // 写进去的就是一条 FK 失败或类型不匹配的默认设置
      const owned = ids.length
        ? await manager.getRepository(ModelProvider).find({
            select: { id: true, type: true },
            where: { id: In(ids), ownerId: userId },
            // 共享行锁：仅把校验挪进事务并不提供隔离性（默认 READ COMMITTED），
            // 校验通过后并发 PATCH 仍可改类型。FOR SHARE 与改类型时的 UPDATE 行锁互斥，
            // 两者互斥后「默认项的类型必然与模型当前类型一致」才成立
            lock: { mode: 'pessimistic_read' },
          })
        : [];
      const ownedById = new Map(
        owned.map((provider) => [provider.id, provider]),
      );
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

      await manager.delete(UserDefaultModel, { ownerId: userId });
      if (rows.length > 0) {
        await manager.save(UserDefaultModel, rows);
      }
    });

    return this.list(userId);
  }
}
