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

  const upstream = httpRequest(
    {
      protocol: backend.protocol,
      hostname: backend.hostname,
      port: backend.port || 80,
      method: req.method,
      path,
      headers: { ...req.headers, host: backend.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
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
