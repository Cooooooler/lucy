import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryClient } from './queryClient';

describe('queryClient', () => {
  it('是 QueryClient 实例且默认配置正确', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.staleTime).toBe(60_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
