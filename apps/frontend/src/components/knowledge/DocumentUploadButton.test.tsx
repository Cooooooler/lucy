import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentUploadButton } from './DocumentUploadButton';

type ButtonProps = Parameters<typeof DocumentUploadButton>[0];

function renderButton(overrides: Partial<ButtonProps> = {}) {
  const props: ButtonProps = {
    onUpload: vi.fn(),
    isUploading: false,
    ...overrides,
  };
  return { ...render(<DocumentUploadButton {...props} />), props };
}

describe('DocumentUploadButton', () => {
  it('选择文件后回调 onUpload（beforeUpload 返回 false，不自动发请求）', async () => {
    const { props, container } = renderButton();
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });

    await userEvent.upload(input as HTMLInputElement, file);

    expect(props.onUpload).toHaveBeenCalledWith(file);
  });

  it('限定可解析的文档类型', () => {
    const { container } = renderButton();

    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.txt,.md,.pdf,.docx',
    );
  });

  it('上传中禁用上传按钮（避免并发上传同一个知识库）', () => {
    renderButton({ isUploading: true });

    expect(screen.getByRole('button', { name: /上传文档/ })).toBeDisabled();
  });
});
