import type { KnowledgeDocumentListItem } from '@/api/types';
import { makeKb } from '@/components/knowledge/knowledge-test-fixture';
import {
  useAddDocument,
  useDeleteDocument,
  useDocument,
  useDocumentList,
  useKnowledgeBase,
} from '@/hooks/use-knowledge';
// 文档夹具与 api/knowledge.test.ts、hooks 用例共用（见 src/test/fixtures.ts）
import { makeDocumentListItem as makeRow } from '@/test/fixtures';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeDetailPage } from './$kbId';

// 工具条的返回入口是路由注入的 <Link>：渲染成裸 <a>（其余路由 API 保持真实），
// 与列表页用例同一约定
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, ...rest }: { to: string }) => <a href={to} {...rest} />,
}));

vi.mock('@/hooks/use-knowledge', () => ({
  KNOWLEDGE_PAGE_SIZE: 20,
  useKnowledgeBase: vi.fn(),
  useDocumentList: vi.fn(),
  useDocument: vi.fn(),
  useAddDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
}));

/**
 * 只拦确认框的配置：失败路径需要直接驱动 onOk 并接住它上抛的拒绝
 * （`onOk` 的拒绝没人接管会被 vitest 记成 unhandled rejection），
 * 其余行为（渲染真实对话框、message 渲染）一律保持真实。
 */
const { confirmRef } = vi.hoisted(() => ({
  confirmRef: { current: null as null | { onOk?: () => unknown } },
}));

vi.mock('antd', async (importOriginal) => {
  const mod = await importOriginal<typeof import('antd')>();
  const useApp = () => {
    const real = mod.App.useApp();
    return {
      ...real,
      modal: {
        ...real.modal,
        confirm: (config: { onOk?: () => unknown }) => {
          confirmRef.current = config;
          return real.modal.confirm(config);
        },
      },
    };
  };
  return { ...mod, App: { ...mod.App, useApp } };
});

const mockedKb = vi.mocked(useKnowledgeBase);
const mockedList = vi.mocked(useDocumentList);
const mockedDoc = vi.mocked(useDocument);
const mockedAdd = vi.mocked(useAddDocument);
const mockedDelete = vi.mocked(useDeleteDocument);

const refetch = vi.fn();

/** 文档列表查询桩：`page` 固定回显 1，断言只看调用方传进去的分页参数 */
function mockList(list: KnowledgeDocumentListItem[], total: number) {
  mockedList.mockReturnValue({
    data: { list, total, page: 1, pageSize: 20 },
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  } as never);
}

/** 变更 hook 桩：返回可断言的句柄（mutateAsync 的实现由用例控制） */
function mockMutation(
  target: typeof mockedAdd | typeof mockedDelete,
  mutateAsync = vi.fn().mockResolvedValue(undefined),
) {
  const handle = { mutateAsync, isPending: false, variables: undefined };
  target.mockReturnValue(handle as never);
  return handle;
}

function renderPage() {
  return render(
    <AntdApp>
      <KnowledgeDetailPage kbId="kb1" />
    </AntdApp>,
  );
}

/** 输入文件（上传入口是 antd Upload 内部的 input[type=file]） */
async function uploadFile(file: File) {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('未找到上传入口');
  await userEvent.upload(input as HTMLInputElement, file);
}

describe('routes/_layout/knowledge/$kbId', () => {
  let addHandle: ReturnType<typeof mockMutation>;
  let deleteHandle: ReturnType<typeof mockMutation>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedKb.mockReturnValue({
      data: makeKb('kb1', '产品文档'),
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    mockList([makeRow()], 1);
    mockedDoc.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    addHandle = mockMutation(mockedAdd);
    deleteHandle = mockMutation(mockedDelete);
  });

  it('用 kbId 与默认分页参数查询，渲染页头与文件表格', () => {
    renderPage();

    expect(mockedList).toHaveBeenCalledWith('kb1', {
      page: 1,
      pageSize: 20,
      keyword: undefined,
    });
    // 页头：返回入口 + 知识库信息
    expect(
      screen.getByRole('link', { name: '返回知识库列表' }),
    ).toHaveAttribute('href', '/knowledge');
    expect(screen.getByText('产品文档')).toBeInTheDocument();
    expect(screen.getByText('产品文档 的描述')).toBeInTheDocument();
    // 表格列
    expect(screen.getByText('文件名')).toBeInTheDocument();
    expect(screen.getByText('intro.md')).toBeInTheDocument();
    expect(screen.getByText('.md')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    // 时间按本地时区展示：断言用同一套 dayjs 格式化，避免把测试机时区写死进期望值
    expect(
      screen.getByText(
        dayjs('2024-01-01T00:00:00Z').format('YYYY-MM-DD HH:mm'),
      ),
    ).toBeInTheDocument();
  });

  it('搜索：回到第 1 页并把 trim 后的关键字交给查询', async () => {
    renderPage();

    await userEvent.type(
      screen.getByPlaceholderText('按文件名或内容搜索'),
      ' 正文 ',
    );
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith('kb1', {
        page: 1,
        pageSize: 20,
        keyword: '正文',
      }),
    );
  });

  it('翻页：把 page 交给查询', async () => {
    mockList(
      Array.from({ length: 20 }, (_, i) => makeRow({ id: `row-${i}` })),
      40,
    );
    renderPage();

    await userEvent.click(screen.getByTitle('2'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith('kb1', {
        page: 2,
        pageSize: 20,
        keyword: undefined,
      }),
    );
  });

  it('删除：先弹确认框，确认后才调接口；失败时提示服务端文案', async () => {
    deleteHandle.mutateAsync.mockRejectedValue(
      Object.assign(new Error('文档不存在'), { name: 'ApiError', status: 404 }),
    );
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(
      screen.getByText('确定要删除「intro.md」吗？此操作不可恢复。'),
    ).toBeInTheDocument();
    expect(deleteHandle.mutateAsync).not.toHaveBeenCalled();

    // 直接驱动 onOk：确认框会把失败原样上抛（失败时保持对话框打开），
    // 在这里 await 到它的拒绝，既断言到提示也不留下 unhandled rejection
    await expect(confirmRef.current?.onOk?.()).rejects.toThrow('文档不存在');

    expect(deleteHandle.mutateAsync).toHaveBeenCalledWith({
      kbId: 'kb1',
      id: 'd1',
    });
    expect(await screen.findByText('文档不存在')).toBeInTheDocument();
  });

  it('删除确认框取消时不调接口', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    expect(deleteHandle.mutateAsync).not.toHaveBeenCalled();
  });

  it('末页最后一条被删时先回退页码，避免拉到空页', async () => {
    // 共 21 条 → 2 页；第 2 页只有 1 行
    mockList([makeRow({ id: 'last' })], 21);
    renderPage();

    await userEvent.click(screen.getByTitle('2'));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 2 }),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(deleteHandle.mutateAsync).toHaveBeenCalledWith({
        kbId: 'kb1',
        id: 'last',
      }),
    );
    // 页码已回退：invalidate 后的重拉直接命中第 1 页
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 1 }),
      ),
    );
  });

  it('上传：选中文件后调用 addDocument 并回到第 1 页', async () => {
    mockList([makeRow({ id: 'last' })], 21);
    renderPage();

    await userEvent.click(screen.getByTitle('2'));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 2 }),
      ),
    );

    const file = new File(['hi'], 'a.md', { type: 'text/markdown' });
    await uploadFile(file);

    await waitFor(() =>
      expect(addHandle.mutateAsync).toHaveBeenCalledWith({ kbId: 'kb1', file }),
    );
    // 新文档排在最前：上传后回到第 1 页
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        'kb1',
        expect.objectContaining({ page: 1 }),
      ),
    );
  });

  it('上传失败：提示服务端文案', async () => {
    addHandle.mutateAsync.mockRejectedValue(
      Object.assign(new Error('文档解析失败'), {
        name: 'ApiError',
        status: 422,
      }),
    );
    renderPage();

    // 文件名必须落在 accept 白名单内：userEvent.upload 会按 accept 过滤掉不匹配的文件，
    // 用 .exe 的话连 beforeUpload 都不会触发（解析失败由后端返回，不是前端拦下的）
    await uploadFile(new File(['hi'], 'a.md', { type: 'text/markdown' }));

    expect(await screen.findByText('文档解析失败')).toBeInTheDocument();
  });

  it('查看：打开抽屉并展示解析全文（标题用原始文件名）', async () => {
    mockedDoc.mockReturnValue({
      data: {
        ...makeRow(),
        content: '解析正文',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '查看' }));

    expect(await screen.findByText('解析正文')).toBeInTheDocument();
    expect(mockedDoc).toHaveBeenCalledWith('kb1', 'd1');
  });

  it('文档列表失败：就地展示错误与重试，不改整页', async () => {
    mockedList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('知识库不存在'), {
        name: 'ApiError',
        status: 404,
      }),
      refetch,
    } as never);
    renderPage();

    expect(screen.getByText('文档加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('知识库详情加载失败：整页错误态 + 返回列表入口，不渲染表格', () => {
    mockedKb.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('知识库不存在'), {
        name: 'ApiError',
        status: 404,
      }),
    } as never);
    renderPage();

    expect(screen.getByText('知识库不存在')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '返回知识库列表' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('空列表：按有无关键字给出不同空态文案', async () => {
    mockList([], 0);
    renderPage();

    // 尚无文档：引导上传
    expect(screen.getByText('暂无文档，可上传')).toBeInTheDocument();

    // 有搜索词但没命中：换个措辞，避免让人以为库里是空的
    await userEvent.type(
      screen.getByPlaceholderText('按文件名或内容搜索'),
      '不存在',
    );
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('没有匹配的文档')).toBeInTheDocument();
  });
});
