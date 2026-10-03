import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelProviderFormDrawer } from './ModelProviderFormDrawer';
import { makeModel } from './model-provider-test-fixture';

const mutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/hooks/use-model-provider', () => ({
  useCreateModelProvider: () => mutations.create,
  useUpdateModelProvider: () => mutations.update,
}));

type DrawerProps = Parameters<typeof ModelProviderFormDrawer>[0];

function renderDrawer(overrides: Partial<DrawerProps> = {}) {
  const props: DrawerProps = {
    open: true,
    mode: 'create',
    onClose: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <AntdApp>
        <ModelProviderFormDrawer {...props} />
      </AntdApp>,
    ),
    props,
  };
}

describe('ModelProviderFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutations.create.mutateAsync.mockResolvedValue(undefined);
    mutations.update.mutateAsync.mockResolvedValue(undefined);
    mutations.create.isPending = false;
    mutations.update.isPending = false;
  });

  it('创建态校验失败时不提交', async () => {
    renderDrawer();
    await userEvent.click(
      await screen.findByRole('button', { name: /创\s*建/ }),
    );
    expect(await screen.findByText('请输入模型名称')).toBeInTheDocument();
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('创建态提交发送完整字段（含 protocol）', async () => {
    const { props } = renderDrawer();
    await userEvent.type(
      await screen.findByLabelText('模型名称'),
      'gpt-4o-mini',
    );
    await userEvent.type(screen.getByLabelText('API Key'), 'sk-secret');
    await userEvent.type(
      screen.getByLabelText('API Base URL'),
      'https://api.openai.com/v1',
    );
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
      name: 'gpt-4o-mini',
      type: 'llm',
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      contextLength: 32768,
      protocol: 'chat-completions',
      apiKey: 'sk-secret',
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('选择 Ollama 后 API Key 选填，Base URL 自动回填且提交不发送 apiKey', async () => {
    renderDrawer();
    await userEvent.type(await screen.findByLabelText('模型名称'), 'qwen2.5');
    await userEvent.click(screen.getByLabelText('模型供应商'));
    await userEvent.click(await screen.findByText('Ollama'));

    // 切换到 Ollama 自动回填默认 Base URL，且协议字段（仅 OpenAI 有意义）隐藏
    expect(screen.getByLabelText('API Base URL')).toHaveValue(
      'http://localhost:11434',
    );
    expect(screen.getByPlaceholderText('Ollama 可留空')).toBeInTheDocument();
    expect(screen.queryByText('API 协议')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
      name: 'qwen2.5',
      type: 'llm',
      vendor: 'ollama',
      baseUrl: 'http://localhost:11434',
      contextLength: 32768,
    });
  });

  it('编辑态预填且不传 apiKey 表示不修改', async () => {
    const model = makeModel('m1', 'existing-model');
    renderDrawer({ mode: 'edit', model });

    expect(
      await screen.findByDisplayValue('existing-model'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('留空表示不修改')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    const [call] = mutations.update.mutateAsync.mock.calls;
    const variables = call[0] as { id: string; input: Record<string, unknown> };
    expect(variables.id).toBe('m1');
    expect(variables.input).not.toHaveProperty('apiKey');
  });

  it('编辑态填写 apiKey 时随请求提交', async () => {
    const model = makeModel('m1', 'existing-model');
    renderDrawer({ mode: 'edit', model });
    await userEvent.type(await screen.findByLabelText('API Key'), 'sk-new');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    const [call] = mutations.update.mutateAsync.mock.calls;
    const variables = call[0] as { input: Record<string, unknown> };
    expect(variables.input.apiKey).toBe('sk-new');
  });

  it('非 LLM 类型隐藏「API 协议」', async () => {
    renderDrawer({
      mode: 'edit',
      model: makeModel('m1', 'tts-model', { type: 'tts' }),
    });
    expect(await screen.findByText('模型类型')).toBeInTheDocument();
    expect(screen.queryByText('API 协议')).not.toBeInTheDocument();
  });
});
