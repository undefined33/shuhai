import { expect, test, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dirname, '../dist');

test('extension service worker starts', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [background] = context.serviceWorkers();

    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }

    expect(background.url()).toContain('chrome-extension://');
  } finally {
    await context.close();
  }
});
