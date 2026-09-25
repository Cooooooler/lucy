import { act, render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { describe, expect, it } from 'vitest';
import { emitApiSuccessMessage } from '../api/messages';
import { ApiMessageBridge } from './ApiMessageBridge';

/** 桥挂在 AntdApp 内（与 main.tsx 一致），收到后端广播即 message.success 展示 */
function renderBridge() {
  return render(
    <AntdApp>
      <ApiMessageBridge />
    </AntdApp>,
  );
}

describe('ApiMessageBridge', () => {
  it('收到广播后弹出后端文案', async () => {
    renderBridge();
    act(() => {
      emitApiSuccessMessage('知识库已删除');
    });
    expect(await screen.findByText('知识库已删除')).toBeInTheDocument();
  });

  it('卸载后不再响应（无泄漏、无报错）', async () => {
    const { unmount } = renderBridge();
    unmount();
    act(() => {
      emitApiSuccessMessage('知识库已删除');
    });
    expect(screen.queryByText('知识库已删除')).not.toBeInTheDocument();
  });
});
