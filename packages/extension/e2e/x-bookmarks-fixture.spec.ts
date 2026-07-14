import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  adaptXBookmarksDom,
  X_BOOKMARKS_ADAPTER_VERSION,
  resolveXBookmarksLimits,
  type XBookmarkDomEntryObservation,
} from '../src/social/adapters/x-bookmarks.js';
import { SYNC_LIMITS } from '../src/social/sync-schema.js';
import {
  XSyncCoordinator,
  type AdapterBatchPort,
  type AdapterBatchRequest,
} from '../src/social/x-sync-coordinator.js';
import { openSyncStore, type SyncStore } from '../src/social/sync-store.js';
import {
  createXBookmarkFixtureEntries,
  createXBookmarksFixturePort,
  hostileXBookmarkFixtureEntry,
} from '../tests/fixtures/x-bookmarks.js';

const BASE_TIME = Date.parse('2026-07-13T00:00:00.000Z');

function freshChromeProfilePath(): string {
  const configured = process.env.SHUHAI_GOAL_043_PROFILE;
  if (!configured) {
    throw new Error('SHUHAI_GOAL_043_PROFILE must name a fresh project-scoped profile');
  }
  const root = path.resolve(process.cwd(), '.pnpm-store', 'goal-043', 'chrome-profile');
  const candidate = path.resolve(configured);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`) || existsSync(candidate)) {
    throw new Error('Chrome profile must be a new child of the Goal 043 profile root');
  }
  return candidate;
}

function timestampSequence(): () => string {
  let tick = 0;
  return () => new Date(BASE_TIME + tick++ * 1_000).toISOString();
}

function overlappingBatches(
  entries: readonly XBookmarkDomEntryObservation[],
): XBookmarkDomEntryObservation[][] {
  const batches: XBookmarkDomEntryObservation[][] = [];
  for (let start = 0; start < entries.length; start += 8) {
    batches.push(entries.slice(start, start + 10));
    if (start + 10 >= entries.length) {
      break;
    }
  }
  return batches;
}

async function renderFixtureBatch(
  page: Page,
  entries: readonly XBookmarkDomEntryObservation[],
): Promise<void> {
  await page.locator('#fixture-feed').evaluate((feed, batch) => {
    feed.replaceChildren(
      ...batch.map((entry) => {
        const article = document.createElement('article');
        article.dataset.fixture = 'bookmark';

        const link = document.createElement('a');
        link.dataset.fixture = 'permalink';
        link.href = entry.permalink;
        link.textContent = entry.title ?? 'Untitled fixture';

        const text = document.createElement('p');
        text.dataset.fixture = 'text';
        text.textContent = entry.text ?? '';

        const author = document.createElement('span');
        author.dataset.fixture = 'author';
        author.dataset.handle = entry.author?.handle ?? '';
        author.textContent = entry.author?.displayName ?? '';

        article.append(link, text, author);
        return article;
      }),
    );
  }, entries);
}

async function readFixtureBatch(page: Page): Promise<XBookmarkDomEntryObservation[]> {
  return page.locator('article[data-fixture="bookmark"]').evaluateAll((articles) =>
    articles.map((article) => {
      const link = article.querySelector<HTMLAnchorElement>('[data-fixture="permalink"]');
      const text = article.querySelector<HTMLElement>('[data-fixture="text"]');
      const author = article.querySelector<HTMLElement>('[data-fixture="author"]');
      return {
        permalink: link?.getAttribute('href') ?? '',
        title: link?.textContent ?? undefined,
        text: text?.textContent ?? undefined,
        author: {
          displayName: author?.textContent ?? undefined,
          handle: author?.dataset.handle ?? undefined,
        },
        publishedAt: '2026-07-13T08:00:00+08:00',
        contentKind: 'post' as const,
        media: [],
      };
    }),
  );
}

class BrowserFixtureAdapter implements AdapterBatchPort {
  private readonly batches: readonly (readonly XBookmarkDomEntryObservation[])[];

  constructor(
    private readonly page: Page,
    entries: readonly XBookmarkDomEntryObservation[],
  ) {
    this.batches = overlappingBatches(entries);
  }

  async readBatch(request: AdapterBatchRequest): Promise<unknown> {
    const batch = this.batches[request.step];
    if (!batch) {
      return { capability: { kind: 'unsupported' }, signal: { kind: 'unsupported' } };
    }
    await renderFixtureBatch(this.page, batch);
    const observations = await readFixtureBatch(this.page);
    const isTerminal = request.step === this.batches.length;
    const result = await adaptXBookmarksDom(
      createXBookmarksFixturePort({
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: isTerminal ? 'terminal' : 'items' },
        observedNodeCount: observations.length,
        entries: observations,
      }),
      {
        capturedAt: '2026-07-13T12:00:00.000Z',
        remainingCandidateSlots: request.remainingCandidateSlots,
        acceptedBytesBefore: request.jobAcceptedBytes,
        limits: request.limits,
        now: () => 0,
      },
    );

    if (request.scanRevision === 1 && request.step === 3 && result.signal.kind === 'items') {
      return {
        ...result,
        signal: {
          kind: 'budget_exceeded',
          budget: 'observed_nodes',
          stopReason: 'budget_exceeded',
        },
      };
    }
    return result;
  }
}

test('rescans a recycled X fixture from the top and resumes without duplicate items', async ({
  browserName: _browserName,
}, testInfo) => {
  let context: BrowserContext | undefined;
  let store: SyncStore | undefined;
  const outboundRequests: string[] = [];
  try {
    context = await chromium.launchPersistentContext(freshChromeProfilePath(), {
      channel: 'chrome',
      headless: true,
      offline: true,
      serviceWorkers: 'block',
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
      outboundRequests.push(route.request().url());
      await route.abort();
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setContent('<main id="fixture-feed"></main>');

    const entries = createXBookmarkFixtureEntries(50);
    entries[0] = hostileXBookmarkFixtureEntry();
    const adapter = new BrowserFixtureAdapter(page, entries);
    const factory = new IDBFactory();
    const nowIso = timestampSequence();
    store = await openSyncStore({
      indexedDB: factory,
      dbName: 'x-bookmarks-browser-fixture',
      now: nowIso,
    });
    const limits = resolveXBookmarksLimits();
    if (!limits) {
      throw new Error('The fixture limits must satisfy the production X adapter contract');
    }
    await store.createJob({
      id: 'browser-fixture-job',
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      scanMode: 'incremental',
      budgets: {
        maxItems: limits.maxItems,
        maxPages: limits.maxBatches,
        maxDurationMs: limits.maxElapsedMs,
        maxItemBytes: SYNC_LIMITS.socialItemBytes,
        maxMediaPerItem: limits.maxMedia,
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    let coordinator = new XSyncCoordinator(store, adapter, {
      now: () => 0,
      nowIso,
    });

    const paused = await coordinator.start({
      jobId: 'browser-fixture-job',
      expectedScanRevision: 0,
      limits,
    });
    expect(paused).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: {
        status: 'paused',
        scanRevision: 1,
        stopRecord: { code: 'budget_exceeded', phase: 'scanning' },
      },
    });
    expect(paused.job.summary.uniqueItemCount).toBeGreaterThan(0);
    expect(paused.job.summary.uniqueItemCount).toBeLessThan(50);

    store.close();
    store = await openSyncStore({
      indexedDB: factory,
      dbName: 'x-bookmarks-browser-fixture',
      now: nowIso,
    });
    coordinator = new XSyncCoordinator(store, adapter, {
      now: () => 0,
      nowIso,
    });
    const resumed = await coordinator.resume({
      jobId: 'browser-fixture-job',
      expectedScanRevision: paused.job.scanRevision,
      limits,
    });

    expect(resumed).toMatchObject({
      outcome: 'ready_for_review',
      job: {
        status: 'ready_for_review',
        scanRevision: 2,
        summary: { uniqueItemCount: 50, pendingReviewCount: 0 },
        checkpoint: { acceptedCount: 50 },
      },
    });
    expect(resumed.job.checkpoint?.scannedCount).toBeGreaterThan(50);
    const persisted = await store.listJobItems('browser-fixture-job');
    expect(persisted).toHaveLength(50);
    expect(new Set(persisted.map((row) => row.sourceItemId)).size).toBe(50);
    await expect(page.locator('article[data-fixture="bookmark"]')).toHaveCount(10);
    await expect(
      page.locator('#fixture-feed img, #fixture-feed iframe, #fixture-feed script'),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('fixture-final.png') });
    expect(outboundRequests).toEqual([]);
  } finally {
    store?.close();
    await context?.close();
  }
});
