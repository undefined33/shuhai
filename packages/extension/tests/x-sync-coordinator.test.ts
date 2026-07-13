import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  XSyncCoordinator,
  type AdapterBatchPort,
  type AdapterBatchRequest,
  type SyncCatalogLookupPort,
} from '../src/social/x-sync-coordinator.js';
import { SyncEngine } from '../src/social/sync-engine.js';
import {
  X_BOOKMARKS_ADAPTER_VERSION,
  X_BOOKMARKS_CEILINGS,
} from '../src/social/adapters/x-bookmarks.js';
import type { AdapterBatchResult, AdapterSignal } from '../src/social/adapters/types.js';
import { openSyncStore, type SyncStore } from '../src/social/sync-store.js';
import {
  SYNC_LIMITS,
  makeSyncRecordKey,
  type SocialItem,
  type SyncRecord,
} from '../src/social/sync-schema.js';
import type { VaultFileOutcome } from '../src/utils/vault-writer.js';

const BASE_TIME = Date.parse('2026-07-13T00:00:00.000Z');
let databaseCounter = 0;
const openStores: SyncStore[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  vi.unstubAllGlobals();
});

function timestamp(second: number): string {
  return new Date(BASE_TIME + second * 1_000).toISOString();
}

function timestampSequence(start = 1): () => string {
  let tick = start;
  return () => timestamp(tick++);
}

function serializeHashInput(entry: Omit<SocialItem, 'contentHash'>): string {
  return JSON.stringify({
    schemaVersion: entry.schemaVersion,
    source: entry.source,
    sourceItemId: entry.sourceItemId,
    canonicalUrl: entry.canonicalUrl,
    title: entry.title ?? null,
    text: entry.text ?? null,
    author:
      entry.author === undefined
        ? null
        : {
            displayName: entry.author.displayName ?? null,
            handle: entry.author.handle ?? null,
          },
    publishedAt: entry.publishedAt ?? null,
    completeness: entry.completeness,
    media: entry.media.map((media) => ({
      type: media.type,
      url: media.url,
      alt: media.alt ?? null,
    })),
    extractorVersion: entry.extractorVersion,
  });
}

async function hashItem(entry: Omit<SocialItem, 'contentHash'>): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializeHashInput(entry)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function item(index: number, overrides: Partial<SocialItem> = {}): Promise<SocialItem> {
  const sourceItemId = overrides.sourceItemId ?? String(10_000 + index);
  const { contentHash, ...fieldOverrides } = overrides;
  const fields: Omit<SocialItem, 'contentHash'> = {
    schemaVersion: 1,
    source: 'x',
    sourceItemId,
    canonicalUrl: `https://x.com/researcher/status/${sourceItemId}`,
    title: `Saved post ${index}`,
    text: `Fixture body ${index}`,
    author: { displayName: 'Researcher', handle: 'researcher' },
    publishedAt: timestamp(0),
    capturedAt: timestamp(1),
    completeness: 'summary_only',
    media: [],
    extractorVersion: X_BOOKMARKS_ADAPTER_VERSION,
    ...fieldOverrides,
  };
  if (fields.title === undefined) delete fields.title;
  if (fields.text === undefined) delete fields.text;
  if (fields.author === undefined) delete fields.author;
  if (fields.publishedAt === undefined) delete fields.publishedAt;
  return {
    ...fields,
    contentHash: contentHash ?? (await hashItem(fields)),
  };
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function batch(
  signal: AdapterSignal,
  items: readonly SocialItem[] = [],
  metrics: Partial<AdapterBatchResult['metrics']> = {},
): AdapterBatchResult {
  return {
    capability: {
      kind: 'collection_scan',
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
    },
    signal,
    items,
    metrics: {
      observedNodes: items.length,
      acceptedItems: items.length,
      acceptedBytes: items.reduce((total, entry) => total + encodedBytes(entry), 0),
      elapsedMs: 0,
      ...metrics,
    },
  };
}

type QueuedBatch = unknown | ((request: AdapterBatchRequest) => unknown | Promise<unknown>);

class QueueAdapter implements AdapterBatchPort {
  readonly requests: AdapterBatchRequest[] = [];

  constructor(private readonly queued: QueuedBatch[]) {}

  async readBatch(request: AdapterBatchRequest): Promise<unknown> {
    this.requests.push(request);
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('No fixture batch remains');
    }
    return typeof next === 'function' ? next(request) : next;
  }
}

class FixtureVaultWriter {
  readonly files = new Map<string, string>();
  writeCalls = 0;
  readCalls = 0;

  async write(pathSegments: readonly string[], markdown: string): Promise<VaultFileOutcome> {
    this.writeCalls += 1;
    const relativePath = pathSegments.join('/');
    if (this.files.has(relativePath)) {
      return { status: 'already_exists', relativePath };
    }
    this.files.set(relativePath, markdown);
    return { status: 'created', relativePath };
  }

  async readPrefix(pathSegments: readonly string[], maxBytes: number): Promise<string | null> {
    this.readCalls += 1;
    const markdown = this.files.get(pathSegments.join('/'));
    if (markdown === undefined) {
      return null;
    }
    const bytes = new TextEncoder().encode(markdown);
    return new TextDecoder().decode(bytes.slice(0, maxBytes + 1));
  }
}

async function createStore(now = timestampSequence(1)): Promise<SyncStore> {
  const store = await openSyncStore({
    dbName: `x-sync-coordinator-${databaseCounter++}`,
    indexedDB: new IDBFactory(),
    now,
  });
  openStores.push(store);
  return store;
}

function coordinator(
  store: SyncStore,
  adapter: AdapterBatchPort,
  catalog: SyncCatalogLookupPort = store,
  nowIso = timestampSequence(1),
): XSyncCoordinator {
  return new XSyncCoordinator(store, catalog, adapter, {
    now: () => 0,
    nowIso,
  });
}

function record(entry: SocialItem, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    schemaVersion: 1,
    key: makeSyncRecordKey(entry.source, entry.sourceItemId),
    source: entry.source,
    sourceItemId: entry.sourceItemId,
    canonicalUrl: entry.canonicalUrl,
    contentHash: entry.contentHash,
    relativePath: `Social/X/${entry.sourceItemId}.md`,
    completeness: entry.completeness,
    extractorVersion: entry.extractorVersion,
    importedAt: timestamp(0),
    lastSeenAt: timestamp(1),
    ...overrides,
  };
}

function jobBudgets() {
  return {
    maxItems: X_BOOKMARKS_CEILINGS.maxItems,
    maxPages: X_BOOKMARKS_CEILINGS.maxBatches,
    maxDurationMs: X_BOOKMARKS_CEILINGS.maxElapsedMs,
    maxItemBytes: SYNC_LIMITS.socialItemBytes,
    maxMediaPerItem: X_BOOKMARKS_CEILINGS.maxMedia,
  };
}

describe('XSyncCoordinator', () => {
  it('persists and classifies a batch before requesting the next virtual-list batch', async () => {
    const store = await createStore();
    const first = await item(1);
    const second = await item(2);
    const fetchSpy = vi.fn(() => {
      throw new Error('Network access is forbidden in fixture coordinator tests');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const adapter = new QueueAdapter([
      batch({ kind: 'items' }, [first]),
      async () => {
        const persisted = await store.listJobItems('persist-before-next');
        expect(persisted).toHaveLength(1);
        expect(persisted[0]?.classification).toBe('new');
        return batch({ kind: 'terminal' }, [{ ...first, capturedAt: timestamp(8) }, second]);
      },
    ]);
    const result = await coordinator(store, adapter).createAndStart({
      jobId: 'persist-before-next',
    });

    expect(result.outcome).toBe('ready_for_review');
    expect(result.job.status).toBe('ready_for_review');
    expect(result.job.checkpoint).toMatchObject({
      scanRevision: 1,
      scannedCount: 3,
      acceptedCount: 2,
      consecutiveKnownIds: 0,
    });
    expect(result.metrics).toMatchObject({ steps: 2, insertedItems: 2, replayedItems: 1 });
    expect(
      (await store.listJobItems('persist-before-next')).map((row) => row.classification),
    ).toEqual(['new', 'new']);
    expect(adapter.requests).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not request another batch when atomic batch persistence fails', async () => {
    const store = await createStore();
    const first = await item(3);
    const second = await item(4);
    const adapter = new QueueAdapter([
      batch({ kind: 'items' }, [first]),
      batch({ kind: 'terminal' }, [second]),
    ]);
    const putBatchSpy = vi
      .spyOn(store, 'putScanBatch')
      .mockRejectedValueOnce(new Error('fixture transaction aborted'));
    try {
      await expect(
        coordinator(store, adapter).createAndStart({ jobId: 'persist-failure-stops-read' }),
      ).rejects.toThrow('fixture transaction aborted');
      expect(adapter.requests).toHaveLength(1);
      expect(await store.listJobItems('persist-failure-stops-read')).toHaveLength(0);
      await expect(store.getJob('persist-failure-stops-read')).resolves.toMatchObject({
        status: 'scanning',
        summary: { uniqueItemCount: 0 },
      });
    } finally {
      putBatchSpy.mockRestore();
    }
  });

  it('pauses on the real invocation deadline when an adapter never settles', async () => {
    const store = await createStore();
    const adapter = new QueueAdapter([() => new Promise<never>(() => undefined)]);
    const startedAt = Date.now();

    const result = await coordinator(store, adapter).createAndStart({
      jobId: 'adapter-deadline',
      limits: { maxElapsedMs: 5 },
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: {
        status: 'paused',
        summary: { uniqueItemCount: 0 },
        stopRecord: { code: 'budget_exceeded', phase: 'scanning' },
      },
      metrics: { steps: 0 },
    });
    expect(result.metrics.elapsedMs).toBeGreaterThanOrEqual(5);
    expect(result.metrics.elapsedMs).toBeLessThan(1_000);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(adapter.requests).toHaveLength(1);
    expect(await store.listJobItems('adapter-deadline')).toHaveLength(0);
  });

  it('applies the same invocation deadline to catalog lookups', async () => {
    const store = await createStore();
    const candidate = await item(40);
    const catalog: SyncCatalogLookupPort = {
      getRecordByKey: () => new Promise<never>(() => undefined),
      getRecordByCanonicalUrl: async () => undefined,
      getRecordByContentHash: async () => undefined,
    };
    const startedAt = Date.now();

    const result = await coordinator(
      store,
      new QueueAdapter([batch({ kind: 'terminal' }, [candidate])]),
      catalog,
    ).createAndStart({
      jobId: 'catalog-deadline',
      limits: { maxElapsedMs: 20 },
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: {
        status: 'paused',
        summary: { uniqueItemCount: 1, pendingReviewCount: 1 },
        stopRecord: { code: 'budget_exceeded', phase: 'scanning' },
      },
    });
    expect(result.metrics.elapsedMs).toBeGreaterThanOrEqual(20);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await expect(
      store.getJobItem('catalog-deadline', candidate.sourceItemId),
    ).resolves.toMatchObject({ classification: 'pending' });
  });

  it('does not wait forever for batch persistence before pausing the invocation', async () => {
    const store = await createStore();
    const candidate = await item(41);
    const putBatchSpy = vi
      .spyOn(store, 'putScanBatch')
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const startedAt = Date.now();
    try {
      const result = await coordinator(
        store,
        new QueueAdapter([batch({ kind: 'terminal' }, [candidate])]),
      ).createAndStart({
        jobId: 'persistence-deadline',
        limits: { maxElapsedMs: 20 },
      });

      expect(result).toMatchObject({
        outcome: 'paused',
        stopReason: 'budget_exceeded',
        job: { status: 'paused', summary: { uniqueItemCount: 0 } },
      });
      expect(result.metrics.elapsedMs).toBeGreaterThanOrEqual(20);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(await store.listJobItems('persistence-deadline')).toHaveLength(0);
    } finally {
      putBatchSpy.mockRestore();
    }
  });

  it('does not allow a delayed terminal transition to commit after the invocation pauses', async () => {
    const store = await createStore();
    const candidate = await item(42);
    const originalFinish = store.finishScan.bind(store);
    const finishSpy = vi.spyOn(store, 'finishScan').mockImplementationOnce(
      (jobId, expectedScanRevision, updatedAt, guard) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            originalFinish(jobId, expectedScanRevision, updatedAt, guard).then(resolve, reject);
          }, 50);
        }),
    );
    try {
      const result = await coordinator(
        store,
        new QueueAdapter([batch({ kind: 'terminal' }, [candidate])]),
      ).createAndStart({
        jobId: 'finish-deadline',
        limits: { maxElapsedMs: 20 },
      });

      expect(result).toMatchObject({
        outcome: 'paused',
        stopReason: 'budget_exceeded',
        job: {
          status: 'paused',
          summary: { uniqueItemCount: 1, pendingReviewCount: 0 },
        },
      });
      await expect(
        store.getJobItem('finish-deadline', candidate.sourceItemId),
      ).resolves.toMatchObject({ classification: 'new' });
      expect(finishSpy.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 80));
      await expect(store.getJob('finish-deadline')).resolves.toMatchObject({
        status: 'paused',
        stopRecord: { code: 'budget_exceeded', phase: 'scanning' },
      });
    } finally {
      finishSpy.mockRestore();
    }
  });

  it('rejects adapter batches that under-report observed nodes for returned items', async () => {
    const store = await createStore();
    const candidates = await Promise.all([item(43), item(44)]);
    const adapter = new QueueAdapter([
      batch({ kind: 'terminal' }, candidates, { observedNodes: 0 }),
    ]);

    const result = await coordinator(store, adapter).createAndStart({
      jobId: 'observed-node-under-report',
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'structure_changed',
      job: { status: 'paused', summary: { uniqueItemCount: 0 } },
    });
    expect(adapter.requests).toHaveLength(1);
    expect(await store.listJobItems('observed-node-under-report')).toHaveLength(0);
  });

  it('rejects over-budget adapter metrics without persisting a signalled partial batch', async () => {
    const cases = [
      {
        suffix: 'nodes',
        limits: { maxObservedNodes: 1 },
        signal: {
          kind: 'budget_exceeded',
          budget: 'observed_nodes',
          stopReason: 'budget_exceeded',
        } as const,
        metrics: { observedNodes: 2 },
      },
      {
        suffix: 'elapsed',
        limits: { maxElapsedMs: 5 },
        signal: {
          kind: 'budget_exceeded',
          budget: 'elapsed_time',
          stopReason: 'budget_exceeded',
        } as const,
        metrics: { elapsedMs: 6 },
      },
    ];

    for (const testCase of cases) {
      const store = await createStore();
      const candidate = await item(testCase.suffix === 'nodes' ? 5 : 6);
      const adapter = new QueueAdapter([batch(testCase.signal, [candidate], testCase.metrics)]);
      const jobId = `over-budget-metrics-${testCase.suffix}`;

      const result = await coordinator(store, adapter).createAndStart({
        jobId,
        limits: testCase.limits,
      });

      expect(result).toMatchObject({
        outcome: 'paused',
        stopReason: 'structure_changed',
        job: { status: 'paused', summary: { uniqueItemCount: 0 } },
      });
      expect(await store.listJobItems(jobId)).toHaveLength(0);
    }
  });

  it('classifies exact catalog identity, changes, conflicts, incomplete items, new items, and lookup errors', async () => {
    const store = await createStore();
    const [existing, changed, hashConflict, fresh, metadata, lookupError, otherIdentity] =
      await Promise.all([
        item(10),
        item(11),
        item(12),
        item(13),
        item(14, { text: undefined, completeness: 'metadata_only' }),
        item(15),
        item(99),
      ]);
    await store.putRecords([
      record(existing),
      record(changed, { contentHash: 'f'.repeat(64) }),
      record(otherIdentity, { contentHash: hashConflict.contentHash }),
    ]);

    const errorKey = makeSyncRecordKey('x', lookupError.sourceItemId);
    const catalog: SyncCatalogLookupPort = {
      getRecordByKey: (key) => {
        if (key === errorKey) {
          throw new Error('Fixture catalog failure');
        }
        return store.getRecordByKey(key);
      },
      getRecordByCanonicalUrl: (url) => store.getRecordByCanonicalUrl(url),
      getRecordByContentHash: (hash) => store.getRecordByContentHash(hash),
    };
    const adapter = new QueueAdapter([
      batch({ kind: 'terminal' }, [existing, changed, hashConflict, fresh, metadata, lookupError]),
    ]);

    const result = await coordinator(store, adapter, catalog).createAndStart({
      jobId: 'catalog-five-way',
    });
    expect(result.outcome).toBe('ready_for_review');
    const classifications = Object.fromEntries(
      (await store.listJobItems('catalog-five-way')).map((row) => [
        row.sourceItemId,
        row.classification,
      ]),
    );
    expect(classifications).toEqual({
      [existing.sourceItemId]: 'existing',
      [changed.sourceItemId]: 'changed',
      [hashConflict.sourceItemId]: 'incomplete',
      [fresh.sourceItemId]: 'new',
      [metadata.sourceItemId]: 'incomplete',
      [lookupError.sourceItemId]: 'error',
    });
    expect(result.job.summary).toMatchObject({
      pendingReviewCount: 0,
      classificationErrorCount: 1,
      uniqueItemCount: 6,
    });
  });

  it('writes only the exact persisted review selection through the Goal 042 Vault engine', async () => {
    const store = await createStore();
    const [fresh, existing] = await Promise.all([item(30), item(31)]);
    await store.putRecords([record(existing)]);
    const fetchSpy = vi.fn(() => {
      throw new Error('Network access is forbidden in fixture integration tests');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const scan = await coordinator(
      store,
      new QueueAdapter([batch({ kind: 'terminal' }, [fresh, existing])]),
    ).createAndStart({ jobId: 'review-to-vault' });
    expect(scan).toMatchObject({
      outcome: 'ready_for_review',
      job: { summary: { uniqueItemCount: 2 } },
    });
    const persisted = Object.fromEntries(
      (await store.listJobItems('review-to-vault')).map((row) => [
        row.sourceItemId,
        row.classification,
      ]),
    );
    expect(persisted).toEqual({
      [fresh.sourceItemId]: 'new',
      [existing.sourceItemId]: 'existing',
    });

    const selection = await store.saveReviewSelection(
      'review-to-vault',
      0,
      [fresh.sourceItemId],
      timestamp(30),
    );
    await store.authorizeReviewSelection(
      'review-to-vault',
      selection.job.reviewRevision,
      [fresh.sourceItemId],
      timestamp(31),
    );
    const writer = new FixtureVaultWriter();
    const engine = new SyncEngine(store, writer, undefined, {
      now: () => new Date(timestamp(32)),
      randomId: () => 'fixture-intent',
    });

    await expect(engine.writeItem('review-to-vault', existing, 'ShuHai')).rejects.toThrow(
      'persisted review authorization',
    );
    expect(writer.writeCalls).toBe(0);
    expect(writer.readCalls).toBe(0);

    await expect(engine.writeItem('review-to-vault', fresh, 'ShuHai')).resolves.toMatchObject({
      outcome: { status: 'created' },
      intentPending: false,
    });
    expect(writer.writeCalls).toBe(1);
    expect(writer.files.size).toBe(1);
    expect([...writer.files.values()][0]).toContain(fresh.canonicalUrl);
    await expect(store.getRecordByKey(`x:${fresh.sourceItemId}`)).resolves.toBeDefined();
    await expect(store.listWriteIntents({ jobId: 'review-to-vault' })).resolves.toEqual([]);
    await expect(
      store.transitionJob('review-to-vault', 'complete', timestamp(33)),
    ).resolves.toMatchObject({
      status: 'complete',
      summary: { selectedCount: 1, excludedCount: 1, createdCount: 1 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects catalog results that do not bind the canonical URL or content hash query', async () => {
    const store = await createStore();
    const [wrongUrlLookup, wrongHashLookup, unrelated] = await Promise.all([
      item(16),
      item(17),
      item(18),
    ]);
    const unrelatedRecord = record(unrelated);
    const catalog: SyncCatalogLookupPort = {
      getRecordByKey: async () => undefined,
      getRecordByCanonicalUrl: async (url) =>
        url === wrongUrlLookup.canonicalUrl ? unrelatedRecord : undefined,
      getRecordByContentHash: async (hash) =>
        hash === wrongHashLookup.contentHash ? unrelatedRecord : undefined,
    };
    const result = await coordinator(
      store,
      new QueueAdapter([batch({ kind: 'terminal' }, [wrongUrlLookup, wrongHashLookup])]),
      catalog,
    ).createAndStart({ jobId: 'catalog-query-binding' });

    expect(result.outcome).toBe('ready_for_review');
    expect(
      (await store.listJobItems('catalog-query-binding')).map((row) => row.classification),
    ).toEqual(['error', 'error']);
    expect(result.job.summary.classificationErrorCount).toBe(2);
  });

  it('revalidates exact X permalinks, canonical media URLs, and the fixed SHA-256 input', async () => {
    const valid = await item(30);
    const invalidCandidates = await Promise.all([
      Promise.resolve({ ...valid, contentHash: 'f'.repeat(64) }),
      item(31, {
        canonicalUrl: 'https://twitter.com/researcher/status/10031',
      }),
      item(32, {
        canonicalUrl: 'https://x.com/researcher-team/status/10032',
        author: { handle: 'researcher-team' },
      }),
      item(33, {
        media: [{ type: 'image', url: 'https://cdn.example.test:444/image.jpg' }],
      }),
      item(34, {
        media: [{ type: 'image', url: 'https://cdn.example.test/image.jpg#fragment' }],
      }),
    ]);

    for (const [index, invalid] of invalidCandidates.entries()) {
      const store = await createStore();
      const result = await coordinator(
        store,
        new QueueAdapter([batch({ kind: 'terminal' }, [invalid])]),
      ).createAndStart({ jobId: `adapter-revalidation-${index}` });
      expect(result).toMatchObject({
        outcome: 'paused',
        stopReason: 'structure_changed',
      });
      expect(await store.listJobItems(`adapter-revalidation-${index}`)).toHaveLength(0);
    }
  });

  it('resumes from the top, ignores a stable replay, and preserves cumulative item and byte budgets', async () => {
    const store = await createStore();
    const first = await item(20);
    const second = await item(21);
    const adapter = new QueueAdapter([
      batch({ kind: 'budget_exceeded', budget: 'observed_nodes', stopReason: 'budget_exceeded' }, [
        first,
      ]),
      batch({ kind: 'terminal' }, [{ ...first, capturedAt: timestamp(20) }, second]),
    ]);
    const sync = coordinator(store, adapter);

    const paused = await sync.createAndStart({ jobId: 'pause-resume' });
    expect(paused).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: { status: 'paused', scanRevision: 1 },
    });
    expect(paused.job.stopRecord).toMatchObject({
      code: 'budget_exceeded',
      phase: 'scanning',
      scanRevision: 1,
      acceptedCount: 1,
    });

    const completed = await sync.resume({
      jobId: 'pause-resume',
      expectedScanRevision: paused.job.scanRevision,
    });
    const replayedFirst = { ...first, capturedAt: timestamp(20) };
    expect(completed.outcome).toBe('ready_for_review');
    expect(completed.job.scanRevision).toBe(2);
    expect(completed.job.checkpoint).toMatchObject({
      scannedCount: 3,
      acceptedCount: 2,
      acceptedBytes: encodedBytes(first) + encodedBytes(replayedFirst) + encodedBytes(second),
      scanRevision: 2,
    });
    expect(completed.metrics).toMatchObject({ insertedItems: 1, replayedItems: 1 });
    expect(adapter.requests[1]).toMatchObject({
      scanRevision: 2,
      jobAcceptedItems: 1,
    });
  });

  it('pauses honestly when exactly fifty items arrive without an explicit terminal signal', async () => {
    const store = await createStore();
    const fifty = await Promise.all(Array.from({ length: 50 }, (_, index) => item(100 + index)));
    const adapter = new QueueAdapter([batch({ kind: 'items' }, fifty)]);

    const result = await coordinator(store, adapter).createAndStart({
      jobId: 'fifty-without-terminal',
      limits: {
        maxItems: 500,
        maxBatches: 200,
        maxObservedNodes: 2_000,
        maxElapsedMs: 150_000,
        maxTextBytes: 80 * 1_024,
        maxMedia: 120,
        maxTotalBytes: 160 * 1_024 * 1_024,
        maxCheckpointBytes: 640 * 1_024,
        maxConsecutiveStructureErrors: 10,
      },
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: {
        status: 'paused',
        summary: { uniqueItemCount: 50 },
        checkpoint: { acceptedCount: 50 },
      },
    });
    expect(adapter.requests[0]?.limits).toEqual(X_BOOKMARKS_CEILINGS);
  });

  it('never requests a twenty-first batch when a supported terminal was not observed', async () => {
    const store = await createStore();
    const repeated = await item(200);
    const adapter = new QueueAdapter(
      Array.from({ length: X_BOOKMARKS_CEILINGS.maxBatches }, () =>
        batch({ kind: 'items' }, [repeated]),
      ),
    );

    const result = await coordinator(store, adapter).createAndStart({
      jobId: 'twenty-step-ceiling',
      limits: { maxBatches: 10_000 },
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      metrics: { steps: 20, insertedItems: 1, replayedItems: 19 },
      job: { checkpoint: { scannedCount: 20, acceptedCount: 1 } },
    });
    expect(adapter.requests).toHaveLength(20);
  });

  it('counts raw cross-batch replay bytes against the sixteen MiB job ceiling', async () => {
    const store = await createStore();
    const known = await item(250);
    const replay = { ...known, capturedAt: timestamp(9) };
    const replayBytes = encodedBytes(replay);
    const adapter = new QueueAdapter([
      batch({ kind: 'budget_exceeded', budget: 'observed_nodes', stopReason: 'budget_exceeded' }, [
        known,
      ]),
      batch({ kind: 'terminal' }, [replay]),
    ]);
    const first = await coordinator(store, adapter, store, timestampSequence(1)).createAndStart({
      jobId: 'byte-ceiling-resume',
    });
    expect(first.outcome).toBe('paused');

    await store.claimScanRevision('byte-ceiling-resume', 1, timestamp(20));
    const nearCeiling = X_BOOKMARKS_CEILINGS.maxTotalBytes - replayBytes + 1;
    await store.putCheckpoint('byte-ceiling-resume', 2, {
      ...first.job.checkpoint!,
      scanRevision: 2,
      acceptedBytes: nearCeiling,
      updatedAt: timestamp(21),
    });
    await store.pauseJobWithStopRecord(
      'byte-ceiling-resume',
      2,
      'user_paused',
      'scanning',
      timestamp(22),
    );

    const result = await coordinator(store, adapter, store, timestampSequence(23)).resume({
      jobId: 'byte-ceiling-resume',
      expectedScanRevision: 2,
    });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'budget_exceeded',
      job: {
        scanRevision: 3,
        checkpoint: { acceptedBytes: nearCeiling, acceptedCount: 1 },
      },
    });
    expect(adapter.requests).toHaveLength(2);
  });

  it('turns malformed adapter output and adapter-version mismatches into typed pauses', async () => {
    const malformedStore = await createStore();
    let getterCalled = false;
    const malformed = Object.defineProperty({}, 'capability', {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error('must not execute');
      },
    });
    const malformedResult = await coordinator(
      malformedStore,
      new QueueAdapter([malformed]),
    ).createAndStart({ jobId: 'malformed-adapter' });
    expect(malformedResult).toMatchObject({
      outcome: 'paused',
      stopReason: 'structure_changed',
      job: { stopRecord: { code: 'structure_changed', phase: 'scanning' } },
    });
    expect(getterCalled).toBe(false);

    const mismatchStore = await createStore();
    await mismatchStore.createJob({
      id: 'adapter-version-mismatch',
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION + 1,
      budgets: jobBudgets(),
      createdAt: timestamp(0),
    });
    const mismatchAdapter = new QueueAdapter([]);
    const mismatch = await coordinator(
      mismatchStore,
      mismatchAdapter,
      mismatchStore,
      timestampSequence(1),
    ).start({
      jobId: 'adapter-version-mismatch',
      expectedScanRevision: 0,
    });
    expect(mismatch).toMatchObject({
      outcome: 'paused',
      stopReason: 'structure_changed',
    });
    expect(mismatchAdapter.requests).toHaveLength(0);
  });

  it('fails closed on a duplicate or stale start command without calling the adapter', async () => {
    const store = await createStore();
    await store.createJob({
      id: 'duplicate-start',
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      budgets: jobBudgets(),
      createdAt: timestamp(0),
    });
    await store.claimScanRevision('duplicate-start', 0, timestamp(1));
    const adapter = new QueueAdapter([]);

    await expect(
      coordinator(store, adapter, store, timestampSequence(2)).start({
        jobId: 'duplicate-start',
        expectedScanRevision: 0,
      }),
    ).rejects.toMatchObject({
      name: 'XSyncCoordinatorError',
      code: 'invalid_state',
    });
    expect(adapter.requests).toHaveLength(0);
  });

  it('does not treat an empty observation as a supported terminal', async () => {
    const store = await createStore();
    const result = await coordinator(
      store,
      new QueueAdapter([batch({ kind: 'empty' })]),
    ).createAndStart({ jobId: 'empty-is-not-terminal' });

    expect(result).toMatchObject({
      outcome: 'paused',
      stopReason: 'structure_changed',
      job: { status: 'paused' },
    });
  });
});
