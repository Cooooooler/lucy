import { DocumentTextDrawer } from '@/components/knowledge/DocumentTextDrawer';
import { useDocument } from '@/hooks/use-knowledge';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-knowledge', () => ({ useDocument: vi.fn() }));

const mockedUseDocument = vi.mocked(useDocument);

// XMarkdown（marked + dompurify，约 44KB）是 lazy() 动态 import，正文要等 chunk 加载完
// 才提交。findBy* 默认超时 1000ms，全量并行跑时这个 import 常超过 1s，会偶发超时。
const LAZY_CHUNK_TIMEOUT = 5000;

const row = {
  id: 'd1',
  knowledgeBaseId: 'kb1',
  fileId: 'f1',
  title: 'intro',
  originalName: 'intro.md',
  ext: '.md',
  mime: 'text/markdown',
  size: 1024,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function noopQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useDocument>;
}

function renderDrawer(doc: typeof row | null) {
  return render(<DocumentTextDrawer kbId="kb1" doc={doc} onClose={vi.fn()} />);
}

describe('DocumentTextDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseDocument.mockReturnValue(noopQuery());
  });

  it('未选中文档时以 undefined 请求（hook 自身会禁用请求）', () => {
    renderDrawer(null);

    expect(mockedUseDocument).toHaveBeenCalledWith('kb1', undefined);
  });

  it('选中文档时以文件名作标题，展示解析全文', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      data: { ...row, content: '解析出来的正文' },
    } as unknown as ReturnType<typeof useDocument>);

    renderDrawer(row);

    expect(await screen.findByText('intro.md')).toBeInTheDocument();
    // XMarkdown 为懒加载：正文经 Suspense 后才提交。
    // findBy* 默认只等 1000ms，而全量并行跑时这个动态 import 常超过 1s
    // （chunk 编译 + 模块求值），会偶发超时。给懒加载留更宽的窗口。
    expect(
      await screen.findByText('解析出来的正文', undefined, {
        timeout: LAZY_CHUNK_TIMEOUT,
      }),
    ).toBeInTheDocument();
  });

  it('解析全文按 Markdown 渲染（标题、列表等语法生效）', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      data: { ...row, content: '# 文档标题\n\n- 条目一\n- 条目二' },
    } as unknown as ReturnType<typeof useDocument>);

    renderDrawer(row);

    expect(
      await screen.findByRole(
        'heading',
        { name: '文档标题' },
        { timeout: LAZY_CHUNK_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('条目一')).toBeInTheDocument();
  });

  it('解析文本为空时给出占位文案', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      data: { ...row, content: null },
    } as unknown as ReturnType<typeof useDocument>);

    renderDrawer(row);

    expect(
      await screen.findByText('（没有可展示的解析文本）'),
    ).toBeInTheDocument();
  });

  it('加载中展示 loading 态', async () => {
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      isLoading: true,
    } as unknown as ReturnType<typeof useDocument>);

    renderDrawer(row);

    // 抽屉渲染在 portal 里：用 screen（查 document.body）而不是 render 的 container
    expect(
      await screen.findByTestId('document-text-loading'),
    ).toBeInTheDocument();
  });

  it('加载失败展示服务端文案（不把技术报错抛给用户）', async () => {
    const error = Object.assign(new Error('文档不存在'), {
      name: 'ApiError',
      status: 404,
    });
    mockedUseDocument.mockReturnValue({
      ...noopQuery(),
      isError: true,
      error,
    } as unknown as ReturnType<typeof useDocument>);

    renderDrawer(row);

    expect(await screen.findByText('文档不存在')).toBeInTheDocument();
  });
});
