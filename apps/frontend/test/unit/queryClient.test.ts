import { queryClient } from '@/queryClient';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

describe('queryClient', () => {
  it('是 QueryClient 实例且默认配置正确（缓存已关闭）', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.staleTime).toBe(0);
    expect(defaults.queries?.gcTime).toBe(5 * 60 * 1000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
