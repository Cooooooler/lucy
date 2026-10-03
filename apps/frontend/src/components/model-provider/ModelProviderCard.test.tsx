import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelProviderCard } from './ModelProviderCard';
import { baseModel, makeModel } from './model-provider-test-fixture';

type CardProps = Parameters<typeof ModelProviderCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onTest: vi.fn(),
    isUpdatePending: false,
    isDeletePending: false,
    isTestPending: false,
  };
  const props: CardProps = { model: baseModel, ...handlers, ...overrides };
  return { ...render(<ModelProviderCard {...props} />), props };
}

describe('ModelProviderCard', () => {
  it('渲染名称、类型、供应商、Base URL、协议、上下文长度与脱敏 Key', () => {
    renderCard();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByText('Chat Completions')).toBeInTheDocument();
    expect(screen.getByText('上下文 128,000 tokens')).toBeInTheDocument();
    expect(screen.getByText('••••••abcd')).toBeInTheDocument();
  });

  it('非 LLM 不显示协议、类型标签映射正确', () => {
    renderCard({
      model: makeModel('m2', 'embed', { type: 'text-embedding' }),
    });
    expect(screen.getByText('文本嵌入')).toBeInTheDocument();
    expect(screen.queryByText('Chat Completions')).not.toBeInTheDocument();
  });

  it('操作栏三个按钮各自上报意图', async () => {
    const { props } = renderCard();
    await userEvent.click(screen.getByLabelText('测试连接'));
    await userEvent.click(screen.getByLabelText('编辑模型'));
    await userEvent.click(screen.getByLabelText('删除模型'));
    expect(props.onTest).toHaveBeenCalledWith(baseModel);
    expect(props.onEdit).toHaveBeenCalledWith(baseModel);
    expect(props.onDelete).toHaveBeenCalledWith(baseModel);
  });

  it('pending 时禁用对应按钮', () => {
    renderCard({
      isTestPending: true,
      isDeletePending: true,
      isUpdatePending: true,
    });
    expect(screen.getByLabelText('测试连接')).toBeDisabled();
    expect(screen.getByLabelText('编辑模型')).toBeDisabled();
    expect(screen.getByLabelText('删除模型')).toBeDisabled();
  });
});
