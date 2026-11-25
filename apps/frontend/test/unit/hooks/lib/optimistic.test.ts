import { applyOptimistic } from '@/hooks/lib/optimistic';
import { createTestQueryClient } from '@test/support/query';
import { describe, expect, it, vi } from 'vitest';

function createClient() {
  return createTestQueryClient();
}

describe('hooks/lib/applyOptimistic', () => {
  it('写入前先取消在途查询，避免响应覆盖乐观值', async () => {
    const client = createClient();
    const cancel = vi.spyOn(client, 'cancelQueries');

    await applyOptimistic(
      client,
      [{ queryKey: ['list'], apply: () => undefined }],
      null,
    );

    expect(cancel).toHaveBeenCalledWith({
      queryKey: ['list'],
      exact: undefined,
    });
  });

  it('前缀命中多份缓存并逐一改写，不影响无关 key', async () => {
    const client = createClient();
    client.setQueryData(['list', 'all'], { v: 1 });
    client.setQueryData(['list', 'filtered'], { v: 2 });
    client.setQueryData(['other'], { v: 3 });

    await applyOptimistic(
      client,
      [
        {
          queryKey: ['list'],
          apply: (old) => ({ v: (old as { v: number }).v + 10 }),
        },
      ],
      null,
    );

    expect(client.getQueryData(['list', 'all'])).toEqual({ v: 11 });
    expect(client.getQueryData(['list', 'filtered'])).toEqual({ v: 12 });
    expect(client.getQueryData(['other'])).toEqual({ v: 3 });
  });

  it('exact 只命中完全相同的 key', async () => {
    const client = createClient();
    client.setQueryData(['base', 'kb1'], { v: 1 });
    client.setQueryData(['base', 'kb1', 'documents', 'list'], { v: 2 });

    await applyOptimistic(
      client,
      [
        {
          queryKey: ['base', 'kb1'],
          exact: true,
          apply: () => ({ v: 99 }),
        },
      ],
      null,
    );

    expect(client.getQueryData(['base', 'kb1'])).toEqual({ v: 99 });
    expect(client.getQueryData(['base', 'kb1', 'documents', 'list'])).toEqual({
      v: 2,
    });
  });

  it('apply 返回 undefined 时原样保留，不会把缓存写成 undefined', async () => {
    const client = createClient();
    client.setQueryData(['list'], { v: 1 });

    await applyOptimistic(
      client,
      [{ queryKey: ['list'], apply: () => undefined }],
      null,
    );

    expect(client.getQueryData(['list'])).toEqual({ v: 1 });
  });

  it('回滚只恢复本次命中的 key', async () => {
    const client = createClient();
    client.setQueryData(['list', 'a'], { v: 1 });
    client.setQueryData(['other'], { v: 3 });

    const rollback = await applyOptimistic(
      client,
      [{ queryKey: ['list'], apply: () => ({ v: 2 }) }],
      null,
    );
    client.setQueryData(['other'], { v: 4 });

    rollback();

    expect(client.getQueryData(['list', 'a'])).toEqual({ v: 1 });
    // 期间发生的无关写入不被回滚波及
    expect(client.getQueryData(['other'])).toEqual({ v: 4 });
  });
});
