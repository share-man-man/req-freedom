import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 与 WXT 生成的 tsconfig paths 保持一致，供后续需要跨目录引用的测试使用。
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // 被测模块均为平台无关的纯函数，不需要 DOM 环境。
    environment: 'node',
    include: ['utils/**/*.test.ts'],
  },
});
