import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { E2E_DB_NAME } from './test/e2e-db-config.js';

export default defineConfig({
  // 与单测一致：SWC 提供 decorator metadata，AppModule 全链路 DI 需要
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    // 与单测同一份 env 注入：envValidationSchema 里 JWT_SECRET / MODEL_PROVIDER_SECRET_KEY
    // 是 required，而 AppModule 在模块求值时就执行 ConfigModule.forRoot() 并校验。
    // 此前这里漏配，导致「本地有 apps/backend/.env 才跑得起来、CI 与干净检出直接失败」。
    setupFiles: ['./src/test/setup.ts'],
    // e2e 必须打独立的测试库：库名必须在 import 阶段之前生效（见 test/prepare-e2e-db.ts 的说明），
    // 所以放在这里而不是各 spec 文件顶部（ESM 提升会让那里的赋值晚于 AppModule 求值）。
    // 库名与「只允许 *_test」的安全阀都来自 test/e2e-db-config.ts —— 直接跑
    // `vitest run --config vitest.e2e.config.ts`（不经过 prepare 脚本）同样会被那条断言挡住。
    env: {
      DB_NAME: E2E_DB_NAME,
      // 模型 baseUrl 的私网/回环一律需显式放行（含 ollama）；e2e 要连本地假地址，
      // 这里给出与生产同一条配置路径。
      OUTBOUND_ALLOW_PRIVATE_HOSTS: '127.0.0.1,localhost,192.168.1.10',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
