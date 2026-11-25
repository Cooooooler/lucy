import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface RendererServer {
  /** 渲染进程应加载的地址 */
  url: string;
  close: () => Promise<void>;
}

/**
 * 后端地址。桌面端不托管后端，只把 API 请求转发给独立运行的 NestJS。
 * 可通过 `LUCY_BACKEND_URL` 指向远程/其他端口。
 */
const BACKEND_URL = process.env.LUCY_BACKEND_URL ?? 'http://localhost:3000';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 只转发渲染进程真正需要的请求头。白名单而不是 `...req.headers`：
 * - 拒绝 `__proto__` / `constructor` / `prototype` 这类会被原型污染利用的键；
 * - 不把渲染进程的 `host`、`connection`、`content-length` 等逐跳/连接级头带进上游。
 */
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cache-control',
  'content-type',
  'cookie',
  'if-modified-since',
  'if-none-match',
  'origin',
  'pragma',
  'range',
  'referer',
  'user-agent',
  'x-requested-with',
]);

/**
 * 只回传业务响应需要的头。刻意不含 `location`：本服务是 API 反向代理，
 * 若把上游的任意 `Location` 原样交给渲染进程，就形成开放重定向面。
 */
const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
  'set-cookie',
  'vary',
  'x-request-id',
]);

function isApiRequest(pathname: string): boolean {
  // prod 渲染进程走 `/${API_VERSION}/`，dev/Web 走 `/api`（详见 api/client.ts）
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/v1' ||
    pathname.startsWith('/v1/')
  );
}

/**
 * 把 API 请求转发给独立的后端。
 *
 * 为什么生产环境也要经本地服务器而不是 `file://`：刷新令牌是 HttpOnly + SameSite=Lax
 * 的 cookie，`file://` 是不透明源，cookie 与 CORS 都无法正常落地。让渲染进程始终从
 * `http://127.0.0.1:<port>` 加载、API 也指向同源，登录态与开发环境完全一致。
 */
function proxyToBackend(req: IncomingMessage, res: ServerResponse): void {
  const backend = new URL(BACKEND_URL);
  const rawUrl = req.url ?? '/';
  // `/api` 是前端代理前缀，需要剥掉；`/v1` 是后端自身的版本前缀，原样转发
  const path = rawUrl.startsWith('/api')
    ? rawUrl.replace(/^\/api/, '') || '/'
    : rawUrl;

  // 目标 origin 必须与配置的后端完全一致：`//evil.example/...`、绝对 URL 等
  // 都能让 `req.url` 把请求带到别的主机，必须在建连前拒绝（SSRF 面）。
  let target: URL;
  try {
    target = new URL(path, backend);
  } catch {
    sendBadRequest(res);
    return;
  }
  // 逐项比对而不是只看 origin：Sonar/静态分析能识别这里的 scheme + host + port
  // 白名单校验，避免把 `target` 当作仍可被用户改写的 URL 使用。
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.hostname !== backend.hostname ||
    target.port !== backend.port
  ) {
    sendBadRequest(res);
    return;
  }

  const headers: Record<string, string | string[] | undefined> =
    Object.create(null);
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || !FORWARDED_REQUEST_HEADERS.has(name)) continue;
    headers[name] = value;
  }
  headers.host = backend.host;

  // NOSONAR(tssecurity:S5144)：目标 scheme/host/port 已与配置后端逐项比对，
  // 用户输入只能改变 path；不存在由请求方选择目标主机的 SSRF 面。
  const upstream = /* NOSONAR */ httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders: Record<string, string | string[] | undefined> =
        Object.create(null);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || !FORWARDED_RESPONSE_HEADERS.has(name)) {
          continue;
        }
        responseHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => res.destroy());
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('后端服务不可用：请确认 NestJS 已启动');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function sendBadRequest(res: ServerResponse): void {
  res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bad request');
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? '/', 'http://localhost').pathname,
    );
  } catch {
    sendNotFound(res);
    return;
  }

  const candidate = resolve(join(root, normalize(pathname)));
  const inRoot = candidate === root || candidate.startsWith(root + sep);
  const hasExtension = pathname !== '/' && extname(pathname) !== '';
  const isFile =
    inRoot && existsSync(candidate) && statSync(candidate).isFile();

  // 越界路径与「带扩展名但不存在」的静态资源都直接 404；
  // 其余路径交给 SPA fallback（/login 等前端路由刷新时仍能拿到 index.html）
  if (!inRoot || (hasExtension && !isFile)) {
    sendNotFound(res);
    return;
  }

  const file = isFile ? candidate : join(root, 'index.html');
  if (!existsSync(file)) {
    sendNotFound(res);
    return;
  }

  const contentType =
    MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': contentType,
    // 构建产物带 hash，可长缓存；index.html 必须每次校验
    'cache-control': isFile
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/** 启动本地静态服务器（仅绑定 127.0.0.1，端口由系统分配） */
export function startRendererServer(rootDir: string): Promise<RendererServer> {
  const root = resolve(rootDir);
  const server = createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // 交给静态处理返回 404
    }

    if (isApiRequest(pathname)) {
      proxyToBackend(req, res);
      return;
    }
    serveStatic(root, req, res);
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resolveClose) =>
            server.close(() => resolveClose()),
          ),
      });
    });
  });
}
