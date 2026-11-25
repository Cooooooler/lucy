import { DenylistService } from '@/redis/denylist.service.js';
import { REDIS_CLIENT } from '@coool/redis-nest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';

/**
 * 内存版 Redis 替身：只实现 `DenylistService` 实际用到的命令。
 *
 * 此前这个用例连的是真实 Redis（`createClient({ host: '127.0.0.1', port: 6379 })`），
 * 带来三个问题：Redis 没起来就红、CI 要先拉 RedisBloom、以及 `afterAll` 会去
 * `del` 全局键 `auth:denylist:*`——正好是开发者本机正在跑的后端在用的键，
 * 一次跑单测就把人家的令牌撤销状态清空。单测必须是 hermetic 的：不联网、不碰外部状态。
 *
 * TTL 不模拟（用例只断言「在/不在」），NX/EX 选项只用于区分「是否已存在」。
 */
class InMemoryRedis {
  /** 普通字符串键（GEN_TS / LOCK / auth:denied:*） */
  private readonly strings = new Map<string, string>();
  /** 布隆过滤器键 → 成员集合（BF.ADD / BF.EXISTS 的语义足够用） */
  private readonly bloom = new Map<string, Set<string>>();
  /** 最近一次 eval 收到的脚本与轮换参数，供用例断言轮换确实走的是那段 Lua */
  rotateScript: string | null = null;
  rotateArgs: { errorRate: number; capacity: number } | null = null;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<'OK' | null> {
    const flags = args.map((arg) => String(arg).toUpperCase());
    // `set(key, value, 'EX', ttl, 'NX')`：NX 只在键不存在时写入
    if (
      flags.includes('NX') &&
      (this.strings.has(key) || this.bloom.has(key))
    ) {
      return Promise.resolve(null);
    }
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) removed += 1;
      if (this.bloom.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(
      this.strings.has(key) || this.bloom.has(key) ? 1 : 0,
    );
  }

  call(command: string, key: string, value: string): Promise<number> {
    switch (command.toUpperCase()) {
      case 'BF.ADD': {
        const members = this.bloom.get(key) ?? new Set<string>();
        this.bloom.set(key, members);
        if (members.has(value)) return Promise.resolve(0);
        members.add(value);
        return Promise.resolve(1);
      }
      case 'BF.EXISTS':
        return Promise.resolve(this.bloom.get(key)?.has(value) ? 1 : 0);
      default:
        return Promise.reject(new Error(`InMemoryRedis 未实现命令 ${command}`));
    }
  }

  /**
   * 模拟 `DenylistService.rotate()` 那段 Lua：
   * `DEL prev` → `EXISTS cur` 则 `RENAME cur prev` → `BF.RESERVE cur`（重置 cur）。
   */
  eval(
    script: string,
    numkeys: number,
    ...argv: (string | number)[]
  ): Promise<number> {
    const keys = argv.slice(0, numkeys).map((key) => String(key));
    const values = argv.slice(numkeys);
    const [cur, prev] = keys;
    if (!cur || !prev) {
      return Promise.reject(new Error('轮换脚本需要 cur / prev 两个键'));
    }

    this.bloom.delete(prev);
    const curMembers = this.bloom.get(cur);
    if (curMembers) {
      this.bloom.delete(cur);
      this.bloom.set(prev, curMembers);
    }
    // BF.RESERVE：cur 重置为空过滤器
    this.bloom.set(cur, new Set());

    this.rotateScript = script;
    this.rotateArgs = {
      errorRate: Number(values[0]),
      capacity: Number(values[1]),
    };
    return Promise.resolve(1);
  }

  /** 用例专用：读某个布隆键里的成员（排序后便于断言） */
  members(key: string): string[] {
    return [...(this.bloom.get(key) ?? [])].sort();
  }
}

/** 每个用例一套全新的替身 + 服务，天然隔离，不需要清理任何外部状态 */
async function createService(
  overrides: Record<string, unknown> = {},
): Promise<{ service: DenylistService; fake: InMemoryRedis }> {
  const fake = new InMemoryRedis();
  // 替身只覆盖 DenylistService 用到的子集，接口对不上，故先转 unknown 再断言为 Redis
  const redis: Redis = fake as unknown as Redis;
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: REDIS_CLIENT, useValue: redis },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          JWT_EXPIRES_IN: '15m',
          ...overrides,
        }),
      },
      DenylistService,
    ],
  }).compile();
  return { service: moduleRef.get(DenylistService), fake };
}

describe('DenylistService', () => {
  it('add 后 isDenied 为 true', async () => {
    const { service } = await createService();
    await service.add('spec-jti-1');
    await expect(service.isDenied('spec-jti-1')).resolves.toBe(true);
  });

  it('未加入的 jti isDenied 为 false', async () => {
    const { service } = await createService();
    await expect(service.isDenied('spec-jti-2')).resolves.toBe(false);
  });

  it('未初始化时 add 自动引导（自创建 cur）', async () => {
    // 替身初始为空（无 cur / prev / gen-ts），add 必须自己完成 BF.RESERVE
    const { service, fake } = await createService();
    expect(fake.members('auth:denylist:cur')).toEqual([]);
    await service.add('spec-jti-selfinit');
    await expect(service.isDenied('spec-jti-selfinit')).resolves.toBe(true);
  });

  it('拿不到初始化锁时直接返回，不重复轮换', async () => {
    // 另一个实例正在初始化：LOCK 已存在，SET NX 返回 null，本实例应放弃并等待下次
    const { service, fake } = await createService();
    await fake.set('auth:denylist:lock', '1');
    await service.ensureInitialized();
    expect(fake.rotateScript).toBeNull();
    await expect(fake.get('auth:denylist:gen-ts')).resolves.toBeNull();
  });

  // 双布隆轮换是「登出后令牌不可复活」的核心：旧一代被 RENAME 成 prev 后，
  // isDenied 同时查 cur 与 prev，否则每次轮换都会把上一代的登出记录整批抹掉。
  it('轮换后旧 jti 仍被 prev 命中，新 jti 照常被拒', async () => {
    // rotationSeconds=0 → 每次 ensureInitialized 都会轮换
    const { service, fake } = await createService({
      BLOOM_ROTATION_SECONDS: 0,
    });

    await service.add('spec-jti-rotate');
    await expect(service.isDenied('spec-jti-rotate')).resolves.toBe(true);

    // 手动触发一次轮换：cur 应被整体搬到 prev，cur 重置为空
    await service.ensureInitialized();
    expect(fake.rotateScript).toContain('RENAME');
    expect(fake.members('auth:denylist:prev')).toEqual(['spec-jti-rotate']);
    expect(fake.members('auth:denylist:cur')).toEqual([]);
    await expect(service.isDenied('spec-jti-rotate')).resolves.toBe(true);

    // 轮换后新登出的 jti 落进新一代 cur，同样被拒
    await service.add('spec-jti-after-rotate');
    await expect(service.isDenied('spec-jti-after-rotate')).resolves.toBe(true);
  });
});
