import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

import { X_SYNC_LAUNCH_INTENT_KEY } from '../src/social/x-sync-launch-intent.js';
import { X_SYNC_BOOKMARKS_URL, X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dirname, '../dist');

function freshExtensionProfilePath(): string {
  const configured = process.env.SHUHAI_GOAL_043_EXTENSION_PROFILE;
  if (!configured) {
    throw new Error('SHUHAI_GOAL_043_EXTENSION_PROFILE must name a fresh project profile');
  }
  const root = path.resolve(process.cwd(), '.pnpm-store', 'goal-043', 'chrome-profile');
  const candidate = path.resolve(configured);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`) || existsSync(candidate)) {
    throw new Error('Extension profile must be a new child of the Goal 043 profile root');
  }
  return candidate;
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  return existing ?? context.waitForEvent('serviceworker');
}

function countPersistedXJobs(worker: Worker): Promise<number> {
  return worker.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('shuhai-sync');
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('success', () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('jobs')) {
            database.close();
            reject(new Error('Sync database does not contain the jobs store'));
            return;
          }
          const transaction = database.transaction('jobs', 'readonly');
          const rows = transaction.objectStore('jobs').getAll();
          rows.addEventListener('error', () => reject(rows.error));
          rows.addEventListener('success', () => {
            const count = rows.result.filter(
              (row) =>
                typeof row === 'object' &&
                row !== null &&
                (row as Record<string, unknown>).source === 'x',
            ).length;
            database.close();
            resolve(count);
          });
        });
      }),
  );
}

const fixtureHtml = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>Bookmarks / X</title></head>
  <body>
    <main data-testid="primaryColumn">
      <article data-testid="tweet">
        <a href="https://x.com/shuhai_fixture/status/900000000000000001">
          <time datetime="2026-07-14T00:00:00.000Z">fixture</time>
        </a>
        <div data-testid="User-Name"><span dir="ltr">Fixture User</span></div>
        <div data-testid="tweetText">Offline extension fixture</div>
      </article>
    </main>
  </body>
</html>`;

test('shows one X popup action and creates no job without optional host permission', async () => {
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('Build @shuhai/extension before running the extension fixture');
  }

  let context: BrowserContext | undefined;
  const outboundRequests: string[] = [];
  try {
    context = await chromium.launchPersistentContext(freshExtensionProfilePath(), {
      channel: 'chrome',
      headless: true,
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
    });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === X_SYNC_BOOKMARKS_URL) {
        await route.fulfill({ body: fixtureHtml, contentType: 'text/html', status: 200 });
        return;
      }
      if (/^https?:/u.test(url)) {
        outboundRequests.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });

    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const fixturePage = context.pages()[0] ?? (await context.newPage());
    await fixturePage.goto(X_SYNC_BOOKMARKS_URL);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await fixturePage.bringToFront();
    await popup.reload({ waitUntil: 'domcontentloaded' });

    await expect(popup.getByRole('heading', { name: '同步新增收藏' })).toBeVisible();
    await expect(popup.getByRole('button', { name: '同步新增收藏' })).toHaveCount(1);
    await expect(popup.getByText('只处理当前 X 收藏页', { exact: false })).toBeVisible();

    await popup.getByRole('button', { name: '同步新增收藏' }).click();
    await expect
      .poll(() =>
        worker.evaluate(async (key) => {
          const api = (
            globalThis as unknown as {
              chrome: {
                storage: {
                  session: { get(storageKey: string): Promise<Record<string, unknown>> };
                };
              };
            }
          ).chrome;
          const stored = await api.storage.session.get(key);
          return stored[key];
        }, X_SYNC_LAUNCH_INTENT_KEY),
      )
      .toMatchObject({ protocol: X_SYNC_PROTOCOL, action: 'start' });

    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
    await fixturePage.bringToFront();
    await sidePanel.reload({ waitUntil: 'domcontentloaded' });

    await expect(sidePanel.getByRole('heading', { name: '允许读取当前 X 收藏页' })).toBeVisible();
    await expect(sidePanel.getByRole('button', { name: '允许读取 X 收藏页' })).toBeVisible();
    await expect(sidePanel.getByRole('button', { name: /开始检查新增收藏/u })).toHaveCount(0);

    const permissionGranted = await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            permissions: {
              contains(input: { origins: string[] }): Promise<boolean>;
            };
          };
        }
      ).chrome;
      return api.permissions.contains({ origins: ['https://x.com/*'] });
    });
    expect(permissionGranted).toBe(false);
    await expect.poll(() => countPersistedXJobs(worker)).toBe(0);
    expect(outboundRequests).toEqual([]);
  } finally {
    await context?.close();
  }
});
