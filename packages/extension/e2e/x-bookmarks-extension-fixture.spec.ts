import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

import { X_SYNC_LAUNCH_INTENT_KEY } from '../src/social/x-sync-launch-intent.js';
import { X_SYNC_BOOKMARKS_URL, X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dirname, '../dist');

function comparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function preparedExtensionProfilePath(): string {
  const configured = process.env.SHUHAI_GOAL_043_EXTENSION_PROFILE;
  if (!configured) {
    throw new Error('SHUHAI_GOAL_043_EXTENSION_PROFILE must name a prepared project profile');
  }
  const root = path.resolve(process.cwd(), '.pnpm-store', 'goal-043', 'chrome-profile');
  const candidate = path.resolve(configured);
  const comparableRoot = comparablePath(root);
  const comparableCandidate = comparablePath(candidate);
  if (
    comparableCandidate === comparableRoot ||
    !comparableCandidate.startsWith(`${comparableRoot}${path.sep}`) ||
    !existsSync(candidate)
  ) {
    throw new Error('Extension profile must be an existing child of the Goal 043 profile root');
  }

  const profileStat = lstatSync(candidate);
  if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) {
    throw new Error('Extension profile must be a normal directory');
  }
  const realRoot = comparablePath(realpathSync.native(root));
  const realCandidate = comparablePath(realpathSync.native(candidate));
  if (
    realCandidate !== comparableCandidate ||
    !realCandidate.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error('Extension profile must resolve inside the Goal 043 profile root');
  }
  return candidate;
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  try {
    return await context.waitForEvent('serviceworker', { timeout: 30_000 });
  } catch {
    throw new Error(
      'Prepared profile did not start ShuHai. Load packages/extension/dist manually, close that dedicated Chrome, then retry.',
    );
  }
}

async function assertCurrentExtensionBuild(worker: Worker): Promise<void> {
  const serviceWorkerPath = path.join(extensionPath, 'background', 'service-worker.js');
  const expectedHash = createHash('sha256').update(readFileSync(serviceWorkerPath)).digest('hex');
  const actualHash = await worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { runtime: { getURL(path: string): string } };
      }
    ).chrome;
    const response = await fetch(api.runtime.getURL('background/service-worker.js'), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Loaded extension does not expose its service worker bundle');
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  });
  if (actualHash !== expectedHash) {
    throw new Error(
      'Prepared profile is not running the current packages/extension/dist build. Reload ShuHai in chrome://extensions and retry.',
    );
  }
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

test('uses a preloaded project profile and creates no job without optional host permission', async () => {
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('Build @shuhai/extension before running the extension fixture');
  }

  let context: BrowserContext | undefined;
  const outboundRequests: string[] = [];
  try {
    context = await chromium.launchPersistentContext(preparedExtensionProfilePath(), {
      channel: 'chrome',
      headless: false,
      offline: true,
      args: [
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
    await assertCurrentExtensionBuild(worker);
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
