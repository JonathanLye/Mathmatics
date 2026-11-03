import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 每个测试文件都在进程内起一个 PGlite 并执行整份 schema.sql；文件多、机器忙（或 CI 的小核数）时，
    // 默认的 5 秒测试/10 秒钩子超时会偶发失败（复审时在联合树上复现过 13 项超时）。放宽超时，不改任何断言。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
