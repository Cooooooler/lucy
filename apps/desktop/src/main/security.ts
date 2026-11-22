import { app, session, shell, type WebContents } from 'electron';

/**
 * 渲染进程的 CSP。
 *
 * - `style-src 'unsafe-inline'`：antd 的 cssinjs 与组件 `style` 属性都会注入内联样式；
 * - `img-src` 放行 Unsplash：登录/注册页的 RippleDistortion 背景图来自该域名；
 * - `connect-src 'self'`：所有 API 都经本地同源服务器（dev 用 electron-vite 代理转发），
 *   渲染进程不直连外部服务。
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// dev 额外放行 Vite HMR（ws）与 React Refresh 注入的内联脚本
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * 应用只需要写剪贴板（ProTable 的 copyable 列），其余能力（摄像头/麦克风/定位/通知等）
 * 一律拒绝。
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

export function installSessionSecurity(isDev: boolean): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? DEV_CSP : PROD_CSP],
      },
    });
  });

  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}

/** 禁止任何 <webview> 附加（本应用不使用 webview） */
export function installGlobalGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** 只把 http(s) 链接交给系统浏览器；其余协议（file:/javascript:/...）一律丢弃 */
export function openExternalSafely(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
  void shell.openExternal(parsed.toString());
}

/**
 * 窗口导航加固：
 * - 新窗口一律拒绝，http(s) 外链交给系统浏览器；
 * - 主动导航只允许停留在自己的 origin（渲染进程路由用 history API，不触发该事件）。
 */
export function hardenWindow(
  contents: WebContents,
  allowedOrigin: string,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    let origin: string | undefined;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = undefined;
    }
    if (origin === allowedOrigin) return;

    event.preventDefault();
    openExternalSafely(url);
  });
}
