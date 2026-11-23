/**
 * dev 编排：先启动后端并等待其就绪，再启动桌面端（`--all` 时同时启动浏览器端）；
 * Electron 退出（或任一服务异常退出）时一并停止全部服务。
 *
 * 为什么不直接 `turbo run dev` 并行跑：
 * - 前端/Electron 一启动就会请求 API，后端还没监听时满屏 404/502；
 * - 关掉 Electron 窗口后 turbo 不会停掉常驻的后端（`nest start --watch` 还会留下
 *   孙进程），端口与数据库连接被残留进程占着，下次启动直接失败。
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const withFrontend = process.argv.includes('--all');
// 后端首次启动要跑 tsc + Nest 装配，慢机器上 120s 是相对宽松的上限
const readyTimeoutMs = Number(process.env.DEV_READY_TIMEOUT_MS ?? 120_000);
const pollIntervalMs = 500;

function log(message) {
  console.log(`\u001b[36m[dev]\u001b[0m ${message}`);
}

function warn(message) {
  console.warn(`\u001b[33m[dev]\u001b[0m ${message}`);
}

/** 端口取自环境变量或 apps/backend/.env（ConfigModule 默认读取该文件），缺省 3000 */
function resolveBackendPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const env = readFileSync(resolve(root, 'apps/backend/.env'), 'utf8');
    const matched = env.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (matched) return Number(matched[1]);
  } catch {}
  return 3000;
}

const tasks = [];
let exiting = false;

function startTask(label, filter) {
  const command = `pnpm exec turbo run dev --filter=${filter}`;
  log(`启动 ${label}：${command}`);
  const child = spawn(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    // POSIX 下放入独立进程组，停止时可连同其子进程（tsc / nest / vite / electron）一起收掉
    detached: !isWindows,
  });
  const task = { label, child, exited: false };
  tasks.push(task);

  child.on('error', (error) => {
    console.error(`[dev] ${label}启动失败：${error.message}`);
    void shutdown(1);
  });
  child.on('exit', (code, signal) => {
    task.exited = true;
    if (exiting) return;
    const reason = signal ? `信号 ${signal}` : `退出码 ${code ?? 1}`;
    log(`${label}已退出（${reason}），停止全部服务`);
    void shutdown(code ?? 1);
  });

  return task;
}

function stopTask(task) {
  const { child } = task;
  if (task.exited || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  if (isWindows) {
    // taskkill /T 连孙进程一起结束（cmd → turbo → nest/vite/electron）
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return Promise.resolve();
  }

  return new Promise((resolveStop) => {
    const force = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
      resolveStop();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(force);
      resolveStop();
    });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      clearTimeout(force);
      child.kill('SIGTERM');
      resolveStop();
    }
  });
}

async function shutdown(code) {
  if (exiting) return;
  exiting = true;
  log('正在停止全部服务…');
  await Promise.all(tasks.map(stopTask));
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (exiting) return;
    log(`收到 ${signal}，停止全部服务`);
    void shutdown(0);
  });
}

/**
 * 轮询就绪探针（`/health/ready` 同时探测 DB 与 Redis）。
 * degraded 说明进程已起来但依赖没通，仍放行并提示，避免没起 docker 时卡死。
 */
async function waitForBackend(backendTask) {
  const readyUrl = `http://127.0.0.1:${resolveBackendPort()}/health/ready`;
  const deadline = Date.now() + readyTimeoutMs;
  let nextNotice = 0;

  log(`等待后端就绪：${readyUrl}`);
  while (Date.now() < deadline) {
    if (backendTask.exited) return 'exited';
    try {
      const response = await fetch(readyUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.data?.status === 'degraded') {
          warn(
            '后端已启动，但数据库/Redis 尚未就绪（degraded）：接口可能暂时不可用，' +
              '请检查 docker compose 是否已启动',
          );
        }
        return 'ready';
      }
    } catch {
      // 端口还没监听 / 正在编译，继续轮询
    }
    if (Date.now() >= nextNotice) {
      log(
        `后端仍在启动中…（${Math.ceil(
          (deadline - Date.now()) / 1000,
        )}s 后超时）`,
      );
      nextNotice = Date.now() + 5_000;
    }
    await new Promise((resolveSleep) =>
      setTimeout(resolveSleep, pollIntervalMs),
    );
  }
  return 'timeout';
}

const backend = startTask('后端', '@lucy/backend');
const status = await waitForBackend(backend);

if (!exiting) {
  if (status === 'timeout') {
    warn(
      `后端在 ${Math.round(readyTimeoutMs / 1000)}s 内未就绪` +
        '（可用 DEV_READY_TIMEOUT_MS 调整超时）',
    );
    await shutdown(1);
  } else if (status === 'ready') {
    log('后端已就绪，启动桌面端（Electron）');
    startTask('桌面端', '@lucy/desktop');
    if (withFrontend) startTask('浏览器端', '@lucy/frontend');
  }
}
