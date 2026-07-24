import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SyncEngine, type SyncEngineStorePort } from '../src/social/sync-engine.js';
import type { SocialItem } from '../src/social/sync-schema.js';
import { openSyncStore, type SyncStore } from '../src/social/sync-store.js';
import { renderSafeSocialMarkdown } from '../src/vault/safe-markdown.js';
import type { VaultFileOutcome } from '../src/utils/vault-writer.js';

const BASE_TIME = Date.parse('2026-07-13T00:00:00.000Z');

class TestClock {
  private tick = 0;

  nextIso(): string {
    const value = new Date(BASE_TIME + this.tick * 1_000).toISOString();
    this.tick += 1;
    return value;
  }

  nextDate(): Date {
    return new Date(this.nextIso());
  }
}

class MemoryWriter {
  readonly files = new Map<string, string>();
  writeCalls = 0;
  readCalls = 0;
  nextOutcome?: VaultFileOutcome;

  async write(pathSegments: readonly string[], markdown: string): Promise<VaultFileOutcome> {
    this.writeCalls += 1;
    const relativePath = pathSegments.join('/');
    if (this.nextOutcome) {
      const outcome = this.nextOutcome;
      this.nextOutcome = undefined;
      return outcome;
    }
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

function socialItem(id: number, overrides: Partial<SocialItem> = {}): SocialItem {
  const sourceItemId = String(1_000_000_000_000_000_000n + BigInt(id));
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId,
    canonicalUrl: `https://x.com/example/status/${sourceItemId}`,
    title: `Saved post ${id}`,
    text: `Body ${id}`,
    capturedAt: '2026-07-13T12:00:00.000Z',
    completeness: 'complete',
    media: [],
    contentHash: id.toString(16).padStart(64, '0'),
    extractorVersion: 1,
    ...overrides,
  };
}

function generatedPath(item: SocialItem, intentId = 'intent-1'): string {
  return `ShuHai/x/${item.sourceItemId}-${intentId}.md`;
}

const BUDGETS = {
  maxItems: 10_000,
  maxPages: 1_000,
  maxDurationMs: 3_600_000,
  maxItemBytes: 64 * 1_024,
  maxMediaPerItem: 12,
};

async function prepareWritingJob(
  store: SyncStore,
  clock: TestClock,
  jobId: string,
  items: readonly SocialItem[],
): Promise<void> {
  await store.createJob({
    id: jobId,
    source: 'x',
    adapterVersion: 1,
    budgets: BUDGETS,
    createdAt: clock.nextIso(),
  });
  await store.claimScanRevision(jobId, 0, clock.nextIso());
  await store.putScanBatch(jobId, 1, items, {
    schemaVersion: 1,
    adapterVersion: 1,
    scanRevision: 1,
    scannedCount: items.length,
    acceptedCount: items.length,
    acceptedBytes: items.reduce(
      (sum, item) => sum + new TextEncoder().encode(JSON.stringify(item)).byteLength,
      0,
    ),
    consecutiveKnownIds: 0,
    updatedAt: clock.nextIso(),
  });
  for (const item of items) {
    await store.updateJobItemClassification(jobId, item.sourceItemId, 'new', 1, clock.nextIso());
  }
  await store.finishScan(jobId, 1, clock.nextIso());
  const selectedIds = items.map((item) => item.sourceItemId);
  const selection = await store.saveReviewSelection(jobId, 0, selectedIds, clock.nextIso());
  await store.authorizeReviewSelection(
    jobId,
    selection.job.reviewRevision,
    selectedIds,
    clock.nextIso(),
  );
}

function engine(store: SyncEngineStorePort, writer: MemoryWriter, clock: TestClock): SyncEngine {
  let intentSequence = 0;
  return new SyncEngine(store, writer, undefined, {
    now: () => clock.nextDate(),
    randomId: () => `intent-${(intentSequence += 1)}`,
  });
}

describe('SyncEngine', () => {
  it('persists an intent before writing and commits the catalog only after close', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-created',
    });
    const item = socialItem(1);
    await prepareWritingJob(store, clock, 'job-created', [item]);
    const writer = new MemoryWriter();

    const result = await engine(store, writer, clock).writeItem('job-created', item, 'ShuHai');

    expect(result).toMatchObject({
      outcome: { status: 'created', relativePath: generatedPath(item) },
      intentPending: false,
    });
    await expect(store.listWriteIntents({ jobId: 'job-created' })).resolves.toEqual([]);
    await expect(store.getRecordByKey(`x:${item.sourceItemId}`)).resolves.toMatchObject({
      contentHash: item.contentHash,
    });
    await expect(store.getJobItem('job-created', item.sourceItemId)).resolves.toMatchObject({
      writeStatus: 'created',
    });
    await expect(
      engine(store, writer, clock).writeItem('job-created', item, 'ShuHai'),
    ).resolves.toMatchObject({ outcome: { status: 'created' }, intentPending: false });
    expect(writer.writeCalls).toBe(1);
    store.close();
  });

  it('rejects source or content that does not match the persisted job item', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-persisted-item-boundary',
    });
    const item = socialItem(9);
    await prepareWritingJob(store, clock, 'job-boundary', [item]);
    const writer = new MemoryWriter();
    const syncEngine = engine(store, writer, clock);

    await expect(
      syncEngine.writeItem('job-boundary', { ...item, text: 'Different body' }, 'ShuHai'),
    ).rejects.toThrow('does not match the persisted sync job item');
    await expect(
      syncEngine.writeItem(
        'job-boundary',
        {
          ...item,
          source: 'weibo',
          canonicalUrl: `https://weibo.com/example/${item.sourceItemId}`,
        },
        'ShuHai',
      ),
    ).rejects.toThrow('source does not match the sync job');
    expect(writer.writeCalls).toBe(0);
    await expect(store.listWriteIntents({ jobId: 'job-boundary' })).resolves.toEqual([]);
    store.close();
  });

  it('does not touch the writer for an excluded or unauthorized item', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-review-authorization',
    });
    const item = socialItem(90);
    await store.createJob({
      id: 'job-excluded',
      source: 'x',
      adapterVersion: 1,
      budgets: BUDGETS,
      createdAt: clock.nextIso(),
    });
    await store.claimScanRevision('job-excluded', 0, clock.nextIso());
    const acceptedBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    await store.putScanBatch('job-excluded', 1, [item], {
      schemaVersion: 1,
      adapterVersion: 1,
      scanRevision: 1,
      scannedCount: 1,
      acceptedCount: 1,
      acceptedBytes,
      consecutiveKnownIds: 0,
      updatedAt: clock.nextIso(),
    });
    await store.updateJobItemClassification(
      'job-excluded',
      item.sourceItemId,
      'existing',
      1,
      clock.nextIso(),
    );
    await store.finishScan('job-excluded', 1, clock.nextIso());
    const selection = await store.saveReviewSelection('job-excluded', 0, [], clock.nextIso());
    await store.authorizeReviewSelection(
      'job-excluded',
      selection.job.reviewRevision,
      [],
      clock.nextIso(),
    );
    const writer = new MemoryWriter();

    await expect(
      engine(store, writer, clock).writeItem('job-excluded', item, 'ShuHai'),
    ).rejects.toThrow('persisted review authorization');
    expect(writer.writeCalls).toBe(0);
    await expect(store.listWriteIntents({ jobId: 'job-excluded' })).resolves.toEqual([]);
    store.close();
  });

  it('does not rewrite an existing catalog item and marks source changes for review', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-dedupe',
    });
    const item = socialItem(2);
    const writer = new MemoryWriter();

    await prepareWritingJob(store, clock, 'job-first', [item]);
    await engine(store, writer, clock).writeItem('job-first', item, 'ShuHai');
    await store.transitionJob('job-first', 'complete', clock.nextIso());

    await prepareWritingJob(store, clock, 'job-existing', [item]);
    const existing = await engine(store, writer, clock).writeItem('job-existing', item, 'ShuHai');
    expect(existing.outcome.status).toBe('already_exists');
    expect(writer.writeCalls).toBe(1);
    await store.transitionJob('job-existing', 'complete', clock.nextIso());

    const changedItem = socialItem(2, { contentHash: 'f'.repeat(64) });
    await prepareWritingJob(store, clock, 'job-changed', [changedItem]);
    const changed = await engine(store, writer, clock).writeItem(
      'job-changed',
      changedItem,
      'ShuHai',
    );
    expect(changed.outcome).toEqual({
      status: 'skipped',
      relativePath: generatedPath(item),
      reason: 'content_changed',
    });
    expect(writer.writeCalls).toBe(1);
    store.close();
  });

  it('fails closed when an occupied path belongs to another source item', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-path-conflict',
    });
    const item = socialItem(3);
    const other = socialItem(4);
    await prepareWritingJob(store, clock, 'job-conflict', [item]);
    const writer = new MemoryWriter();
    writer.files.set(generatedPath(item), renderSafeSocialMarkdown(other));

    const result = await engine(store, writer, clock).writeItem('job-conflict', item, 'ShuHai');

    expect(result.outcome).toEqual({
      status: 'error',
      relativePath: generatedPath(item),
      code: 'path_conflict',
    });
    await expect(store.getRecordByKey(`x:${item.sourceItemId}`)).resolves.toBeUndefined();
    await expect(store.listWriteIntents({ jobId: 'job-conflict' })).resolves.toEqual([]);
    store.close();
  });

  it('commits explicit writer errors without catalog success', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-writer-error',
    });
    const item = socialItem(5);
    await prepareWritingJob(store, clock, 'job-error', [item]);
    const writer = new MemoryWriter();
    writer.nextOutcome = {
      status: 'error',
      relativePath: generatedPath(item),
      errorCode: 'permission_denied',
      error: 'Permission denied',
    };

    const result = await engine(store, writer, clock).writeItem('job-error', item, 'ShuHai');

    expect(result.outcome).toEqual({
      status: 'error',
      relativePath: generatedPath(item),
      code: 'permission_denied',
    });
    await expect(store.listWriteIntents({ jobId: 'job-error' })).resolves.toEqual([]);
    await expect(store.getRecordByKey(`x:${item.sourceItemId}`)).resolves.toBeUndefined();
    store.close();
  });

  it('retries a persisted writer error only after the job re-enters writing', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-writer-retry',
    });
    const item = socialItem(10);
    await prepareWritingJob(store, clock, 'job-retry', [item]);
    const writer = new MemoryWriter();
    writer.nextOutcome = {
      status: 'error',
      relativePath: generatedPath(item),
      errorCode: 'permission_denied',
    };
    const syncEngine = engine(store, writer, clock);

    await expect(syncEngine.writeItem('job-retry', item, 'ShuHai')).resolves.toMatchObject({
      outcome: { status: 'error', code: 'permission_denied' },
    });
    await expect(syncEngine.writeItem('job-retry', item, 'ShuHai')).rejects.toThrow(
      'partial-to-writing authorization',
    );
    await store.transitionJob('job-retry', 'partial', clock.nextIso());
    await expect(syncEngine.writeItem('job-retry', item, 'ShuHai')).rejects.toThrow(
      'not in the writing state',
    );
    await store.authorizeReviewSelection('job-retry', 1, [item.sourceItemId], clock.nextIso());
    await expect(syncEngine.writeItem('job-retry', item, 'ShuHai')).resolves.toMatchObject({
      outcome: { status: 'created' },
      intentPending: false,
    });
    await expect(store.getJob('job-retry')).resolves.toMatchObject({
      summary: { createdCount: 1, writeErrorCount: 0, writePendingCount: 0 },
    });
    expect([...writer.files.keys()]).toEqual([generatedPath(item)]);
    store.close();
  });

  it('distinguishes a catalog path identity conflict from a content change', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-catalog-conflict',
    });
    const item = socialItem(11);
    const other = socialItem(12);
    await store.putRecord({
      schemaVersion: 1,
      key: `x:${item.sourceItemId}`,
      source: 'x',
      sourceItemId: item.sourceItemId,
      canonicalUrl: item.canonicalUrl,
      contentHash: item.contentHash,
      relativePath: `ShuHai/x/${item.sourceItemId}.md`,
      completeness: item.completeness,
      extractorVersion: item.extractorVersion,
      importedAt: clock.nextIso(),
      lastSeenAt: clock.nextIso(),
    });
    await prepareWritingJob(store, clock, 'job-catalog-conflict', [item]);
    const writer = new MemoryWriter();
    writer.files.set(`ShuHai/x/${item.sourceItemId}.md`, renderSafeSocialMarkdown(other));

    await expect(
      engine(store, writer, clock).writeItem('job-catalog-conflict', item, 'ShuHai'),
    ).resolves.toMatchObject({
      outcome: { status: 'error', code: 'catalog_conflict' },
      intentPending: false,
    });
    store.close();
  });

  it('keeps a missing-file intent pending during restart reconciliation', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-pending',
    });
    const item = socialItem(6);
    await prepareWritingJob(store, clock, 'job-pending', [item]);
    await store.putWriteIntent({
      id: 'intent-pending',
      jobId: 'job-pending',
      sourceItemId: item.sourceItemId,
      relativePath: `ShuHai/x/${item.sourceItemId}.md`,
      reviewRevision: 1,
      createdAt: clock.nextIso(),
    });

    const [result] = await engine(store, new MemoryWriter(), clock).reconcilePendingIntents(
      'job-pending',
    );

    expect(result).toMatchObject({
      outcome: { status: 'error', code: 'vault_file_missing' },
      intentPending: true,
    });
    await expect(store.listWriteIntents({ jobId: 'job-pending' })).resolves.toHaveLength(1);
    store.close();
  });

  it('does not read or write the Vault while a writing job is paused', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-paused-writing',
    });
    const item = socialItem(14);
    await prepareWritingJob(store, clock, 'job-paused-writing', [item]);
    await store.putWriteIntent({
      id: 'intent-paused-writing',
      jobId: 'job-paused-writing',
      sourceItemId: item.sourceItemId,
      relativePath: `ShuHai/x/${item.sourceItemId}.md`,
      reviewRevision: 1,
      createdAt: clock.nextIso(),
    });
    await store.pauseJobWithStopRecord(
      'job-paused-writing',
      1,
      'permission_revoked',
      'writing',
      clock.nextIso(),
    );
    const writer = new MemoryWriter();

    await expect(
      engine(store, writer, clock).reconcilePendingIntents('job-paused-writing'),
    ).rejects.toThrow('persisted review authorization');
    expect(writer.readCalls).toBe(0);
    expect(writer.writeCalls).toBe(0);
    await expect(store.listWriteIntents({ jobId: 'job-paused-writing' })).resolves.toHaveLength(1);
    store.close();
  });

  it('resumes the same intent after a crash before the file was created', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-before-file-crash',
    });
    const item = socialItem(13);
    await prepareWritingJob(store, clock, 'job-before-file', [item]);
    await store.putWriteIntent({
      id: 'intent-before-file',
      jobId: 'job-before-file',
      sourceItemId: item.sourceItemId,
      relativePath: `ShuHai/x/${item.sourceItemId}.md`,
      reviewRevision: 1,
      createdAt: clock.nextIso(),
    });
    const writer = new MemoryWriter();

    await expect(
      engine(store, writer, clock).writeItem('job-before-file', item, 'DifferentPrefix'),
    ).resolves.toMatchObject({
      outcome: { status: 'created' },
      intentPending: false,
    });
    expect(writer.writeCalls).toBe(1);
    expect([...writer.files.keys()]).toEqual([`ShuHai/x/${item.sourceItemId}.md`]);
    await expect(store.listWriteIntents({ jobId: 'job-before-file' })).resolves.toEqual([]);
    await expect(store.getRecordByKey(`x:${item.sourceItemId}`)).resolves.toBeDefined();
    store.close();
  });

  it('reconciles 50 close-before-catalog crashes without duplicate files or records', async () => {
    const factory = new IDBFactory();
    const clock = new TestClock();
    const dbName = 'engine-fifty-crashes';
    let store = await openSyncStore({ indexedDB: factory, dbName });
    const items = Array.from({ length: 50 }, (_, index) => socialItem(index + 100));
    await prepareWritingJob(store, clock, 'job-fifty', items);
    const writer = new MemoryWriter();
    let commitAttempts = 0;
    const crashingPort: SyncEngineStorePort = {
      getJob: (jobId) => store.getJob(jobId),
      getJobItem: (jobId, sourceItemId) => store.getJobItem(jobId, sourceItemId),
      getRecordByKey: (key) => store.getRecordByKey(key),
      putWriteIntent: (input) => store.putWriteIntent(input),
      listWriteIntents: (options) => store.listWriteIntents(options),
      commitWriteIntent: async () => {
        commitAttempts += 1;
        throw new Error('simulated service worker termination after file close');
      },
    };
    const crashingEngine = engine(crashingPort, writer, clock);

    for (const item of items) {
      await expect(crashingEngine.writeItem('job-fifty', item, 'ShuHai')).rejects.toThrow(
        'simulated service worker termination',
      );
    }
    expect(commitAttempts).toBe(50);
    expect(writer.files.size).toBe(50);
    await expect(store.listWriteIntents({ jobId: 'job-fifty', limit: 100 })).resolves.toHaveLength(
      50,
    );
    store.close();

    store = await openSyncStore({ indexedDB: factory, dbName });
    const resumed = await engine(store, writer, clock).reconcilePendingIntents('job-fifty');

    expect(resumed).toHaveLength(50);
    expect(resumed.every((result) => result.outcome.status === 'already_exists')).toBe(true);
    expect(resumed.every((result) => result.reconciled)).toBe(true);
    expect(writer.writeCalls).toBe(50);
    expect(writer.files.size).toBe(50);
    await expect(store.listRecords({ limit: 100 })).resolves.toHaveLength(50);
    await expect(store.listWriteIntents({ jobId: 'job-fifty', limit: 100 })).resolves.toEqual([]);
    store.close();
  });

  it('rejects writes before explicit user review transitions the job to writing', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-review-gate',
    });
    const item = socialItem(7);
    await store.createJob({
      id: 'job-review',
      source: 'x',
      adapterVersion: 1,
      budgets: BUDGETS,
      createdAt: clock.nextIso(),
    });

    await expect(
      engine(store, new MemoryWriter(), clock).writeItem('job-review', item, 'ShuHai'),
    ).rejects.toThrow('not in the writing state');
    store.close();
  });

  it('does not claim a committed outcome when the catalog transaction fails', async () => {
    const clock = new TestClock();
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'engine-transaction-failure',
    });
    const item = socialItem(8);
    await prepareWritingJob(store, clock, 'job-transaction', [item]);
    const writer = new MemoryWriter();
    const port: SyncEngineStorePort = {
      getJob: (jobId) => store.getJob(jobId),
      getJobItem: (jobId, sourceItemId) => store.getJobItem(jobId, sourceItemId),
      getRecordByKey: (key) => store.getRecordByKey(key),
      putWriteIntent: (input) => store.putWriteIntent(input),
      listWriteIntents: (options) => store.listWriteIntents(options),
      commitWriteIntent: async (_intentId: string, _outcome: unknown, _committedAt?: string) => {
        throw new Error('transaction aborted');
      },
    };

    await expect(
      engine(port, writer, clock).writeItem('job-transaction', item, 'ShuHai'),
    ).rejects.toThrow('transaction aborted');
    await expect(store.listWriteIntents({ jobId: 'job-transaction' })).resolves.toHaveLength(1);
    await expect(store.getRecordByKey(`x:${item.sourceItemId}`)).resolves.toBeUndefined();
    store.close();
  });
});
