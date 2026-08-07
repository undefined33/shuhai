import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/extension/e2e',
  timeout: 30000,
  globalTimeout: 120000,
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  outputDir: './.tmp/host-stability-narrow-v1/test/playwright-output',
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
