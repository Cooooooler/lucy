import type { RenderResult } from '@testing-library/react';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/** 渲染内容并返回 container，用于测试 renderHook 返回的 content */
export function renderContent(content: ReactNode): RenderResult {
  return render(<div>{content}</div>);
}
