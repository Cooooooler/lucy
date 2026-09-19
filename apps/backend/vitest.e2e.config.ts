import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与单测一致：SWC 提供 decorator metadata，AppModule 全链路 DI 需要
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    // e2e 必须打独立的测试库：库名必须在 import 阶段之前生效（见 test/prepare-e2e-db.ts 的说明），
    // 所以放在这里而不是各 spec 文件顶部（ESM 提升会让那里的赋值晚于 AppModule 求值）。
    // 与 prepare 脚本读同一处来源：两边都取 DB_NAME（缺省 lucy_test），否则 shell 里导出
    // DB_NAME=foo_test 时会出现「准备了 foo_test、用例却连 lucy_test」的错位。
    env: { DB_NAME: process.env.DB_NAME ?? 'lucy_test' },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
