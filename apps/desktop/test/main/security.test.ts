import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * security.ts 的行为测试。
 *
 * electron 在纯 Node 进程里不可用（`require('electron')` 只返回二进制路径），
 * 因此整体 mock 掉，并把真实的回调参数「抓」下来逐个调用 —— 断言的是
 * 我们注册给 Electron 的策略本身，而不是 mock 是否被调用。
 */
const electronMock = vi.hoisted(() => ({
  onHeadersReceived: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  appOn: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: electronMock.appOn },
  session: {
    defaultSession: {
      webRequest: { onHeadersReceived: electronMock.onHeadersReceived },
      setPermissionRequestHandler: electronMock.setPermissionRequestHandler,
      setPermissionCheckHandler: electronMock.setPermissionCheckHandler,
    },
  },
  shell: { openExternal: electronMock.openExternal },
}));

import {
  hardenWindow,
  installGlobalGuards,
  installSessionSecurity,
  openExternalSafely,
} from '../../src/main/security.ts';

type HeadersReceivedHandler = (
  details: { responseHeaders?: Record<string, string[]> },
  callback: (response: { responseHeaders: Record<string, string[]> }) => void,
) => void;

type PermissionRequestHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type PermissionCheckHandler = (
  contents: unknown,
  permission: string,
) => boolean;

type WebContentsCreatedHandler = (
  event: unknown,
  contents: { on: (event: string, handler: (e: unknown) => void) => void },
) => void;

/** 取出首次注册时传入的第 argIndex 个参数（通常是回调）并断言它存在 */
function captured<T>(mock: { mock: { calls: unknown[][] } }, argIndex = 0): T {
  const call = mock.mock.calls[0];
  expect(call, '应当已经注册过一次').toBeDefined();
  expect(call[argIndex], `第 ${argIndex + 1} 个参数应当存在`).toBeDefined();
  return call[argIndex] as T;
}

/** 安装 CSP 钩子并把最终的 CSP 头取出来 */
function installAndReadCsp(isDev: boolean): string {
  installSessionSecurity(isDev);
  const handler = captured<HeadersReceivedHandler>(
    electronMock.onHeadersReceived,
  );

  let csp = '';
  handler({ responseHeaders: { 'X-Trace': ['1'] } }, (response) => {
    // 原有响应头必须保留，只追加 CSP
    expect(response.responseHeaders['X-Trace']).toEqual(['1']);
    csp = response.responseHeaders['Content-Security-Policy']?.[0] ?? '';
  });
  return csp;
}

/** 走一遍 request handler，拿到授权结果 */
function requestPermission(permission: string): boolean {
  const handler = captured<PermissionRequestHandler>(
    electronMock.setPermissionRequestHandler,
  );
  let granted: boolean | undefined;
  handler({}, permission, (value) => {
    granted = value;
  });
  return granted ?? false;
}

/** 走一遍 check handler，拿到授权结果 */
function checkPermission(permission: string): boolean {
  const handler = captured<PermissionCheckHandler>(
    electronMock.setPermissionCheckHandler,
  );
  return handler({}, permission);
}

/** 假的 WebContents：只记录注册进来的处理器，供测试手动触发 */
function createFakeWebContents() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const contents = {
    setWindowOpenHandler: vi.fn((handler: (...args: never[]) => unknown) => {
      handlers.set('window-open', handler);
    }),
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    }),
  };
  return {
    contents: contents as unknown as Parameters<typeof hardenWindow>[0],
    handlers,
    raw: contents,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installSessionSecurity - CSP', () => {
  it('生产环境注入收紧的 CSP', () => {
    const csp = installAndReadCsp(false);

    // 三条关键指令：默认同源、禁插件、禁跨源连接
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // 生产绝不能带 eval / ws
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
  });

  it('dev 环境额外放行 Vite HMR 的 ws 与 unsafe-eval', () => {
    const csp = installAndReadCsp(true);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
    );
    expect(csp).toContain("'unsafe-eval'");
  });
});

describe('installSessionSecurity - 权限白名单', () => {
  it('只允许 clipboard-sanitized-write', () => {
    installSessionSecurity(false);

    expect(requestPermission('clipboard-sanitized-write')).toBe(true);
    expect(checkPermission('clipboard-sanitized-write')).toBe(true);

    for (const denied of ['media', 'notifications', 'geolocation']) {
      expect(requestPermission(denied), denied).toBe(false);
      expect(checkPermission(denied), denied).toBe(false);
    }
  });
});

describe('installGlobalGuards', () => {
  it('web-contents-created 时阻止 will-attach-webview', () => {
    installGlobalGuards();

    expect(electronMock.appOn).toHaveBeenCalledWith(
      'web-contents-created',
      expect.any(Function),
    );
    const onCreated = captured<WebContentsCreatedHandler>(
      electronMock.appOn,
      1,
    );

    const on = vi.fn();
    onCreated({}, { on });
    expect(on).toHaveBeenCalledWith(
      'will-attach-webview',
      expect.any(Function),
    );

    const preventDefault = vi.fn();
    const onAttach = on.mock.calls[0]?.[1] as (e: unknown) => void;
    onAttach({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('openExternalSafely', () => {
  it('http/https 交给系统浏览器', () => {
    openExternalSafely('https://lucy.example/docs');
    openExternalSafely('http://lucy.example/docs');

    expect(electronMock.openExternal).toHaveBeenNthCalledWith(
      1,
      'https://lucy.example/docs',
    );
    expect(electronMock.openExternal).toHaveBeenNthCalledWith(
      2,
      'http://lucy.example/docs',
    );
  });

  it('javascript:/file:/非法 URL 一律丢弃', () => {
    openExternalSafely('javascript:alert(1)');
    openExternalSafely('file:///C:/Windows/System32/drivers/etc/hosts');
    openExternalSafely('not a url');

    expect(electronMock.openExternal).not.toHaveBeenCalled();
  });
});

describe('hardenWindow', () => {
  const allowedOrigin = 'http://127.0.0.1:5174';

  it('新窗口一律 deny，http(s) 改走系统浏览器', () => {
    const { contents, handlers } = createFakeWebContents();
    hardenWindow(contents, allowedOrigin);

    const onWindowOpen = handlers.get('window-open') as (details: {
      url: string;
    }) => { action: string };
    expect(onWindowOpen).toBeTypeOf('function');

    expect(onWindowOpen({ url: 'https://lucy.example/doc' })).toEqual({
      action: 'deny',
    });
    expect(electronMock.openExternal).toHaveBeenCalledWith(
      'https://lucy.example/doc',
    );

    // 非 http(s) 协议连浏览器都不打开
    electronMock.openExternal.mockClear();
    expect(onWindowOpen({ url: 'javascript:alert(1)' })).toEqual({
      action: 'deny',
    });
    expect(electronMock.openExternal).not.toHaveBeenCalled();
  });

  it('will-navigate 允许同源、拦截并外跳其他源', () => {
    const { contents, handlers } = createFakeWebContents();
    hardenWindow(contents, allowedOrigin);

    const onWillNavigate = handlers.get('will-navigate') as (
      event: { preventDefault: () => void },
      url: string,
    ) => void;
    expect(onWillNavigate).toBeTypeOf('function');

    // 同源：渲染进程自己的路由跳转，放行
    const sameOriginPrevent = vi.fn();
    onWillNavigate(
      { preventDefault: sameOriginPrevent },
      `${allowedOrigin}/knowledge/1`,
    );
    expect(sameOriginPrevent).not.toHaveBeenCalled();
    expect(electronMock.openExternal).not.toHaveBeenCalled();

    // 跨源：拦截并交给系统浏览器
    const externalPrevent = vi.fn();
    onWillNavigate(
      { preventDefault: externalPrevent },
      'https://evil.example/phish',
    );
    expect(externalPrevent).toHaveBeenCalledTimes(1);
    expect(electronMock.openExternal).toHaveBeenCalledWith(
      'https://evil.example/phish',
    );

    // 非法 URL：仍然拦截，且不会外跳（openExternalSafely 自行丢弃）
    electronMock.openExternal.mockClear();
    const invalidPrevent = vi.fn();
    onWillNavigate({ preventDefault: invalidPrevent }, 'not a url');
    expect(invalidPrevent).toHaveBeenCalledTimes(1);
    expect(electronMock.openExternal).not.toHaveBeenCalled();
  });
});
