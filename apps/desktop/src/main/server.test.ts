import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererServer } from './server.ts';

/**
 * server.ts 的行为测试：真实临时目录 + 真实 HTTP 请求。
 * 不用 msw/mock：静态服务、SPA fallback、越界防护与反代的全部价值都在
 * 「真实文件系统 + 真实 socket」上，mock 掉就只剩空转。
 */

const INDEX_HTML =
  '<!doctype html><html><body><div id="root"></div></body></html>';
const HASHED_JS = 'console.log("hashed asset");';
const BINARY = 'BINARY-PAYLOAD';
/** 根目录之外的敏感文件内容：任何越界请求都不允许把它读出来 */
const SECRET = 'TOP-SECRET-OUTSIDE-ROOT';
/** 静态资源用例不碰反代，指向一个必然拒绝连接的端口以免误连真实后端 */
const UNUSED_BACKEND = 'http://127.0.0.1:1';

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

let tmpRoot: string;
let rendererDir: string;
let noIndexDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'lucy-desktop-server-'));
  rendererDir = join(tmpRoot, 'renderer');
  noIndexDir = join(tmpRoot, 'no-index');
  mkdirSync(join(rendererDir, 'assets'), { recursive: true });
  mkdirSync(noIndexDir, { recursive: true });

  writeFileSync(join(rendererDir, 'index.html'), INDEX_HTML);
  writeFileSync(join(rendererDir, 'assets', 'app.9f8e7d.js'), HASHED_JS);
  writeFileSync(
    join(rendererDir, 'assets', 'style.1a2b3c.css'),
    'a{color:red}',
  );
  writeFileSync(join(rendererDir, 'assets', 'raw.9a8b7c.bin'), BINARY);
  // 与静态根同级：越界请求若能读到它，就说明路径防护失效
  writeFileSync(join(tmpRoot, 'secret.txt'), SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * 用 node:http 发原始路径：fetch（undici）会先把 `/%2e%2e/` 归一化掉，
 * 那样根本测不到服务器自己的解码与越界判断。
 */
function rawRequest(
  baseUrl: string,
  rawPath: string,
  method = 'GET',
  body?: string,
): Promise<RawResponse> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname,
        port,
        path: rawPath,
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** server.ts 在模块顶层读取 LUCY_BACKEND_URL，故先 stub env 再重置模块缓存 */
async function loadServerModule(
  backendUrl: string,
): Promise<typeof import('./server.ts')> {
  vi.stubEnv('LUCY_BACKEND_URL', backendUrl);
  vi.resetModules();
  return import('./server.ts');
}

/** 起一个真的渲染服务器，并保证在 finally 里关闭 */
async function withRendererServer<T>(
  backendUrl: string,
  fn: (baseUrl: string) => Promise<T>,
  rootDir = rendererDir,
): Promise<T> {
  const { startRendererServer } = await loadServerModule(backendUrl);
  const server: RendererServer = await startRendererServer(rootDir);
  try {
    return await fn(server.url);
  } finally {
    await server.close();
  }
}

/** 起一个桩后端，记录收到的请求，并保证在 finally 里关闭 */
async function withStubBackend<T>(
  fn: (ctx: { url: string; requests: RecordedRequest[] }) => Promise<T>,
): Promise<T> {
  const requests: RecordedRequest[] = [];
  const stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });

  await new Promise<void>((resolveListen) =>
    stub.listen(0, '127.0.0.1', resolveListen),
  );
  const { port } = stub.address() as AddressInfo;
  try {
    return await fn({ url: `http://127.0.0.1:${port}`, requests });
  } finally {
    await new Promise<void>((resolveClose) => stub.close(() => resolveClose()));
  }
}

/** 拿一个当前无人监听的端口，用于「后端未启动」场景 */
async function findClosedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen) =>
    probe.listen(0, '127.0.0.1', resolveListen),
  );
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  return port;
}

describe('startRendererServer - 静态资源', () => {
  it('`/` 返回 index.html 且禁止缓存', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(baseUrl, '/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      // 入口 HTML 每次都要校验：升级后必须拿到新的 hash 资源名
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toBe(INDEX_HTML);
    });
  });

  it('HEAD 请求只回头不含 body', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(baseUrl, '/', 'HEAD');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toBe('');
    });
  });

  it('带 hash 的产物按扩展名给出 content-type 与 immutable 长缓存', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const js = await rawRequest(baseUrl, '/assets/app.9f8e7d.js');
      expect(js.status).toBe(200);
      expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(js.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(js.body).toBe(HASHED_JS);

      const css = await rawRequest(baseUrl, '/assets/style.1a2b3c.css');
      expect(css.headers['content-type']).toBe('text/css; charset=utf-8');

      // 未知扩展名回落到二进制流，而不是当 HTML 塞给浏览器
      const bin = await rawRequest(baseUrl, '/assets/raw.9a8b7c.bin');
      expect(bin.headers['content-type']).toBe('application/octet-stream');
      expect(bin.body).toBe(BINARY);
    });
  });

  it('SPA fallback：无扩展名的前端路由返回 index.html', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(baseUrl, '/knowledge/abc');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toBe(INDEX_HTML);
    });
  });

  it('带扩展名但不存在 = 404（不能回落成 index.html）', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(baseUrl, '/assets/missing.1234.js');
      expect(res.status).toBe(404);
      expect(res.body).toBe('Not found');
    });
  });

  it('静态路径上的非 GET/HEAD 请求返回 405 与 Allow 头', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(
        baseUrl,
        '/assets/app.9f8e7d.js',
        'POST',
        '{"x":1}',
      );
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
      expect(res.body).toBe('');
    });
  });

  it('根目录没有 index.html 时 SPA fallback 也是 404', async () => {
    await withRendererServer(
      UNUSED_BACKEND,
      async (baseUrl) => {
        const res = await rawRequest(baseUrl, '/dashboard');
        expect(res.status).toBe(404);
      },
      noIndexDir,
    );
  });

  it('非法百分号编码不会抛未捕获异常，直接 404', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      const res = await rawRequest(baseUrl, '/%zz');
      expect(res.status).toBe(404);
      expect(res.body).toBe('Not found');
    });
  });
});

describe('startRendererServer - 路径越界防护', () => {
  it('编码的 .. 越界路径一律 404，且不泄漏根目录外的文件', async () => {
    await withRendererServer(UNUSED_BACKEND, async (baseUrl) => {
      // fetch 会在客户端吃掉这些编码，必须用 node:http 发原始 path
      const rawPaths = [
        '/%2e%2e/%2e%2e/secret.txt',
        '/%2e%2e%2fsecret.txt',
        '/%2e%2e%2f%2e%2e%2fsecret.txt',
        '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      ];

      for (const rawPath of rawPaths) {
        const res = await rawRequest(baseUrl, rawPath);
        expect(res.status, rawPath).toBe(404);
        expect(res.body, rawPath).not.toContain(SECRET);
      }
    });
  });
});

describe('startRendererServer - API 反代', () => {
  it('`/api/health` 剥掉 /api 前缀后转发为 /health', async () => {
    await withStubBackend(async ({ url: backendUrl, requests }) => {
      await withRendererServer(backendUrl, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/health`);
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          ok: true,
          path: '/health',
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ method: 'GET', url: '/health' });
      });
    });
  });

  it('`/v1/x` 原样转发（/v1 是后端自己的版本前缀），并保留 query', async () => {
    await withStubBackend(async ({ url: backendUrl, requests }) => {
      await withRendererServer(backendUrl, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/x?page=2`);
        expect(res.status).toBe(200);
        expect(requests[0]).toMatchObject({ url: '/v1/x?page=2' });
      });
    });
  });

  it('裸 `/api` 转发为后端的 `/`', async () => {
    await withStubBackend(async ({ url: backendUrl, requests }) => {
      await withRendererServer(backendUrl, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api`);
        expect(res.status).toBe(200);
        expect(requests[0]).toMatchObject({ url: '/' });
      });
    });
  });

  it('请求方法与 body 一并转发', async () => {
    await withStubBackend(async ({ url: backendUrl, requests }) => {
      await withRendererServer(backendUrl, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/knowledge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"title":"lucy"}',
        });
        expect(res.status).toBe(200);
        expect(requests[0]).toMatchObject({
          method: 'POST',
          url: '/v1/knowledge',
          body: '{"title":"lucy"}',
        });
      });
    });
  });

  it('后端未启动时返回 502 与中文提示', async () => {
    const closedPort = await findClosedPort();
    await withRendererServer(
      `http://127.0.0.1:${closedPort}`,
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/health`);
        expect(res.status).toBe(502);
        expect(res.headers.get('content-type')).toBe(
          'text/plain; charset=utf-8',
        );
        await expect(res.text()).resolves.toBe(
          '后端服务不可用：请确认 NestJS 已启动',
        );
      },
    );
  });
});
