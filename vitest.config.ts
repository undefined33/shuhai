import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const isRootRun = path.resolve(process.cwd()) === path.resolve(rootDir);

export default defineConfig({
  test: {
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: isRootRun ? ['./packages/extension/tests/setup.ts'] : [],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.pnpm-store/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
      thresholds: {
        statements: 31.9,
        branches: 71,
        functions: 59,
        lines: 31.9,
      },
    },
  },
});
