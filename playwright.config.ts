import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/extension/e2e',
  timeout: 30000,
  reporter: [['list']],
  use: {
    headless: false,
    trace: 'retain-on-failure',
  },
});
