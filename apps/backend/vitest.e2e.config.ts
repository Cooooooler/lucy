import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import {
  E2E_DB_HOST,
  E2E_DB_NAME,
  E2E_DB_PASSWORD,
  E2E_DB_PORT,
  E2E_DB_USER,
} from './test/support/e2e-db-config.js';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const testDir = fileURLToPath(new URL('./test', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      '@test': testDir,
    },
  },
  // 与单测一致：SWC 提供 decorator metadata，AppModule 全链路 DI 需要
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    allowOnly: false,
    include: ['test/e2e/**/*.e2e-spec.ts'],
    // 与单测同一份 env 注入：envValidationSchema 里 JWT_SECRET / MODEL_PROVIDER_SECRET_KEY
    // 是 required，而 AppModule 在模块求值时就执行 ConfigModule.forRoot() 并校验。
    // 此前这里漏配，导致「本地有 apps/backend/.env 才跑得起来、CI 与干净检出直接失败」。
    // 第二项是测试库体检：库没准备过（或没迁移）就直接失败并提示先跑 prepare，
    // 而不是拿着过期库跑出一堆诡异断言失败。
    setupFiles: [
      './test/support/setup.ts',
      './test/support/require-e2e-db.ts',
    ],
    /**
     * 所有 e2e spec 共用**同一个**测试库，并行跑会互相踩：各 spec 都在注册/删除自己的
     * `e2e_*` 账号，`users.email` 上还有唯一约束与 CHECK，同时插入同一批数据会出
     * 409/约束错误这类与用例无关的假失败。串行执行还要配合下面的 `retry`——
     * 单库共享时偶发的顺序噪声无法靠隔离消除。
     */
    fileParallelism: false,
    // 共享库上的偶发失败（连接抖动、迁移后的首次查询）在 CI 里重试一次；
    // 本地保持 0，否则真实失败会被重试掩盖，调试时看不到第一手报错。
    retry: process.env.CI ? 1 : 0,
    // e2e 必须打独立的测试库：库名必须在 import 阶段之前生效（见 test/support/prepare-e2e-db.ts 的说明），
    // 所以放在这里而不是各 spec 文件顶部（ESM 提升会让那里的赋值晚于 AppModule 求值）。
    // 库名与「只允许 *_test」的安全阀都来自 test/e2e-db-config.ts —— 直接跑
    // `vitest run --config vitest.e2e.config.ts`（不经过 prepare 脚本）同样会被那条断言挡住。
    //
    // 这里把 e2e 依赖的**全部**环境变量显式钉住：`apps/backend/.env` 会被 ConfigModule 读入，
    // 开发者本机的 DB_HOST/UPLOAD_DIR/LOG_LEVEL 一旦漏进来，e2e 就会连开发库、
    // 往真实 uploads 目录写文件（或把 CI 日志刷满）。test.env 优先于 .env（见 .env 的加载语义）。
    env: {
      NODE_ENV: 'test',
      DB_HOST: E2E_DB_HOST,
      DB_PORT: String(E2E_DB_PORT),
      DB_USER: E2E_DB_USER,
      DB_PASSWORD: E2E_DB_PASSWORD,
      DB_NAME: E2E_DB_NAME,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      // 0 = 随机空闲端口，避免与本地正在跑的后端（3000）撞车
      PORT: '0',
      LOG_LEVEL: 'silent',
      FILE_STORAGE: 'local',
      // 上传目录落在系统临时目录：e2e 会真的写文件，不能污染仓库里的 uploads/
      UPLOAD_DIR: join(tmpdir(), 'lucy-e2e-uploads'),
      // 与 test/support/setup.ts 同值：AppModule 求值时的 envValidationSchema 校验需要它们
      JWT_SECRET: 'test-secret-test-secret-test-secret-32',
      MODEL_PROVIDER_SECRET_KEY: 'test-model-provider-secret-32-chars-long',
      // 模型 baseUrl 的私网/回环一律需显式放行（含 ollama）；e2e 要连本地假地址，
      // 这里给出与生产同一条配置路径。
      OUTBOUND_ALLOW_PRIVATE_HOSTS: '127.0.0.1,localhost,192.168.1.10',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
