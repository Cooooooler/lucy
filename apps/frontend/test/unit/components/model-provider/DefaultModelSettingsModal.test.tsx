import { DefaultModelSettingsModal } from '@/components/model-provider/DefaultModelSettingsModal';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@test/support/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listModelProvidersApi: vi.fn(),
  getModelProviderDefaultsApi: vi.fn(),
  updateModelProviderDefaultsApi: vi.fn(),
}));

vi.mock('@/api/model-provider', () => api);

/**
 * 每个用例创建一个稳定的 client，并让 wrapper 闭包持有它。
 *
 * 不能在 wrapper 组件体内 `createTestQueryClient()`：wrapper 每次渲染都会重新执行，
 * provider 的 value 随之换新、整棵查询缓存被丢弃；rerender 场景下「缓存复用」就成了
 * 假象（实际是重新请求）。也不能在 wrapper 里用 useMemo——小写函数名会被 react-hooks
 * 规则判为非法调用点。
 */
function makeWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AntdApp>{children}</AntdApp>
    </QueryClientProvider>
  );
}

describe('DefaultModelSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('打开后回显已保存的默认模型', async () => {
    api.getModelProviderDefaultsApi.mockResolvedValue({
      defaults: [
        { type: 'llm', modelProviderId: 'm-llm' },
        { type: 'text-embedding', modelProviderId: null },
      ],
    });
    api.listModelProvidersApi.mockResolvedValue({
      list: [
        {
          id: 'm-llm',
          ownerId: 'u1',
          name: 'gpt-4o-mini',
          type: 'llm',
          vendor: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          protocol: 'chat-completions',
          contextLength: 128000,
          apiKeyMasked: '••••abcd',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
    });

    render(<DefaultModelSettingsModal open onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
  });

  it('默认设置尚未加载完成时禁用保存，避免空表单覆盖已有设置', () => {
    api.getModelProviderDefaultsApi.mockReturnValue(new Promise(() => {}));
    api.listModelProvidersApi.mockResolvedValue({
      list: [],
      nextCursor: null,
    });

    render(<DefaultModelSettingsModal open onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    expect(screen.getByRole('button', { name: /保\s*存/ })).toBeDisabled();
  });

  it('默认设置读取失败时禁用保存', async () => {
    api.getModelProviderDefaultsApi.mockRejectedValue(new Error('boom'));
    api.listModelProvidersApi.mockResolvedValue({
      list: [],
      nextCursor: null,
    });

    render(<DefaultModelSettingsModal open onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /保\s*存/ })).toBeDisabled(),
    );
    expect(api.updateModelProviderDefaultsApi).not.toHaveBeenCalled();
  });

  it('保存后关闭再打开仍然回显', async () => {
    const defaults = {
      defaults: [{ type: 'llm', modelProviderId: 'm-llm' }],
    };
    api.getModelProviderDefaultsApi.mockResolvedValue(defaults);
    api.updateModelProviderDefaultsApi.mockResolvedValue(defaults);
    api.listModelProvidersApi.mockResolvedValue({
      list: [
        {
          id: 'm-llm',
          ownerId: 'u1',
          name: 'gpt-4o-mini',
          type: 'llm',
          vendor: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          protocol: 'chat-completions',
          contextLength: 128000,
          apiKeyMasked: '••••abcd',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
    });

    const { rerender } = render(
      <DefaultModelSettingsModal open onClose={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    rerender(<DefaultModelSettingsModal open={false} onClose={vi.fn()} />);
    rerender(<DefaultModelSettingsModal open onClose={vi.fn()} />);

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
  });
});
