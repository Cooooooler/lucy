import { expect, test, type Page } from '@playwright/test';

/**
 * 路由冒烟：逐个打开页面，要求「页面真的渲染出来了」且「控制台无 error、无未捕获异常」。
 *
 * 为什么单测之外还需要它：本仓启用了 React Compiler，它会把 `useCallback(fn, [])` 这类
 * 「不依赖响应式值」的回调提升（outline）到模块作用域。一旦这类回调捕获了不该捕获的局部变量，
 * 只有运行时才会炸（实测整页白屏），而 tsc / lint / vitest 全都发现不了——vitest 走 SWC
 * 不跑 Compiler，`vite build` 只打包不执行。真实浏览器是本仓唯一能拦住这类缺陷的环节。
 *
 * 全程不依赖后端：所有 `/api/**` 都在浏览器网络层被拦下并返回信封化假数据，
 * 因此不需要 DB / Redis / Nest 进程，CI 里也能直接跑。
 */

/** 后端统一信封：{ code, message, data } */
const envelope = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ code: 0, message: 'ok', data }),
});

const FAKE_USER = {
  id: 'e2e-user',
  username: 'e2e',
  nickname: 'E2E',
  email: 'e2e@example.com',
  // 角色给 admin：/users 有 hasMinRole('admin') 的路由守卫，否则会被重定向掉
  role: 'admin',
  status: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const fakeKnowledgeBase = (i: number) => ({
  id: `kb${i}`,
  ownerId: FAKE_USER.id,
  visibility: i % 2 === 0 ? 'private' : 'public',
  name: `知识库 ${i}`,
  description: `第 ${i} 个知识库`,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  likeCount: i,
  isLiked: false,
});

/** 文档列表项（详情页文件表格）：字段集与 KnowledgeDocumentListItemDto 一致 */
const fakeDocument = () => ({
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
});

const fakeModelProvider = (i: number) => ({
  id: `m${i}`,
  ownerId: FAKE_USER.id,
  name: `model-${i}`,
  type: i % 2 === 0 ? 'llm' : 'text-embedding',
  vendor: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'chat-completions',
  contextLength: 128000,
  apiKeyMasked: '••••••abcd',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

/**
 * 未匹配到的接口统一返回「空列表页」：同时带上游标分页（list/nextCursor）与 offset 分页
 * （total/page/pageSize）两套字段，多带的字段对另一种形态无害，页面各自渲染空态即可。
 */
const EMPTY_PAGE = {
  list: [],
  nextCursor: null,
  total: 0,
  page: 1,
  pageSize: 20,
};

/**
 * 只拦「真正的后端请求」：路径以 `/api/v{n}/`（dev，经 vite proxy）或 `/v{n}/`
 * （NODE_ENV 被判成 production 时前端绕开 /api 代理的形态）开头。
 *
 * ⚠️ 不能用 `**\/api\/**` 这类宽松模式：它会连应用自己的源码模块 `/src/api/client.ts`
 * 一起拦掉并返回 JSON，浏览器随后报 `Failed to load module script … MIME type
 * "application/json"`，`#root` 始终为空——实测整页不渲染，且表面上像是应用的 bug。
 */
const API_PATH = /^https?:\/\/[^/]+\/(?:api\/)?v\d+\//;

async function stubApi(page: Page, authenticated: boolean) {
  await page.route(API_PATH, (route) => {
    const url = route.request().url();
    // bootstrap：refresh 换 accessToken → /auth/me 换 user（缺任一步都会被守卫踢回登录页）
    if (url.includes('/auth/refresh')) {
      // 「无会话」用 200 + 业务错误码表达，而不是 HTTP 401，两个原因：
      // 1) 401 会走 handleSessionExpired() → router.navigate('/login')，/register 会被重定向掉，测不到；
      // 2) 浏览器会把 401 记成 console error（"Failed to load resource: 401"），而我们断言的是「无 error」，
      //    那是这条用例自己制造的假失败。
      // 200 + 非 0 业务码：unwrapEnvelope 抛 ApiError(code=40101)、bootstrap 落到 logout，页面照常渲染。
      return authenticated
        ? route.fulfill(envelope({ accessToken: 'e2e-token' }))
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 40101, message: '未登录' }),
          });
    }
    if (url.includes('/auth/me')) {
      return route.fulfill(envelope(FAKE_USER));
    }
    // 顺序要紧：/knowledge/{id}/documents 与 /knowledge/{id} 都包含 '/knowledge'
    if (url.includes('/documents')) {
      return route.fulfill(
        envelope({
          list: [fakeDocument()],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      );
    }
    // 单个知识库详情：/knowledge/{id}（列表是 /knowledge 或 /knowledge?…）
    if (/\/knowledge\/[^/?]+$/.test(url)) {
      return route.fulfill(envelope(fakeKnowledgeBase(1)));
    }
    if (url.includes('/knowledge')) {
      return route.fulfill(
        envelope({ ...EMPTY_PAGE, list: [1, 2, 3].map(fakeKnowledgeBase) }),
      );
    }
    if (url.includes('/model-providers')) {
      return route.fulfill(
        envelope({ ...EMPTY_PAGE, list: [1, 2].map(fakeModelProvider) }),
      );
    }
    return route.fulfill(envelope(EMPTY_PAGE));
  });
}

type RouteCase = {
  path: string;
  /** 文档标题（ProLayout 由菜单名派生，「菜单名 - Lucy」） */
  title: string;
  /** 「页面真的渲染了」的锚点：白屏或错误边界会让它超时失败 */
  anchor: string;
  /** 是否以已登录身份访问，默认 true；登录/注册页必须用未登录态访问 */
  authenticated?: boolean;
  /**
   * 落地后应停在哪条路径，默认与 path 相同。
   * 显式断言路径能挡住「页面被重定向走、其实没测到」这类假阳性——
   * 实测踩过两次：已登录访问 /login 会被弹回首页；未登录时给 HTTP 401 会让 /register 被弹到 /login。
   * 而文档标题对登录/注册页是静态的 "Lucy"，光看标题发现不了重定向。
   */
  expectPath?: string;
};

const ROUTES: RouteCase[] = [
  {
    path: '/login',
    title: 'Lucy',
    anchor: 'input[placeholder="用户名或邮箱"]',
    authenticated: false,
  },
  {
    path: '/register',
    title: 'Lucy',
    anchor: 'input[placeholder="lucy"]',
    authenticated: false,
  },
  { path: '/', title: '首页 - Lucy', anchor: 'text=用户数' },
  { path: '/knowledge', title: '知识库 - Lucy', anchor: 'text=新增知识库' },
  {
    path: '/knowledge/kb1',
    // ProLayout 的文档标题按菜单路径**精确**匹配，/knowledge/kb1 不是菜单项，回落到应用名
    title: 'Lucy',
    // 「上传文档」是详情页工具条里的固定入口，白屏/运行时异常会让它超时失败
    anchor: 'text=上传文档',
  },
  {
    path: '/chat',
    title: '聊天机器人 - Lucy',
    // 不能用「选择模型」：配了模型后该 Select 会显示已选模型，占位文案就不在了
    anchor: 'text=新建会话',
  },
  // /integration 是纯布局路由，index 会 redirect 到第一个子路由
  {
    path: '/integration',
    title: '模型供应商 - Lucy',
    anchor: 'text=新增模型',
    expectPath: '/integration/model-provider',
  },
  {
    path: '/integration/model-provider',
    title: '模型供应商 - Lucy',
    anchor: 'text=新增模型',
  },
  { path: '/users', title: '用户管理 - Lucy', anchor: 'text=用户名' },
];

for (const route of ROUTES) {
  const { path, title, anchor, authenticated = true } = route;
  const expectedPath = route.expectPath ?? path;

  test(`${path} 打开无报错`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error')
        errors.push(`[console] ${message.text()}`);
    });
    page.on('pageerror', (error) =>
      errors.push(`[pageerror] ${error.name}: ${error.message}`),
    );

    await stubApi(page, authenticated);
    await page.goto(path);

    await expect(page).toHaveTitle(title);
    try {
      await expect(page.locator(anchor).first()).toBeVisible();
    } catch (error) {
      // 锚点缺失通常意味着整页没渲染出来（如运行时异常被 ErrorBoundary 兜住）。
      // 把已捕获的控制台报错一并抛出，失败信息里直接能看到根因，省掉一轮排查。
      throw new Error(
        `${(error as Error).message}\n\n控制台报错：\n${errors.join('\n') || '（无）'}`,
        { cause: error },
      );
    }
    expect(new URL(page.url()).pathname).toBe(expectedPath);

    // 留一个短观察窗：报错可能发生在渲染提交之后的异步回调里（如数据落地后）
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });
}
