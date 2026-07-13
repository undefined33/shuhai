import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  ActiveSyncJobExistsError,
  CorruptSyncRowError,
  InvalidSyncJobTransitionError,
  SyncStoreConflictError,
  openSyncStore,
  type SyncStore,
} from '../src/social/sync-store.js';
import {
  SYNC_LIMITS,
  makeSyncRecordKey,
  type SocialItem,
  type SocialSource,
  type SyncCheckpoint,
  type SyncRecord,
} from '../src/social/sync-schema.js';

const MIB = 1_024 * 1_024;
const FIXTURE_MEMORY_BUDGET = 32 * MIB;
const HASH = 'a'.repeat(64);

function timestamp(second: number): string {
  return `2026-07-13T00:00:${String(second).padStart(2, '0')}Z`;
}

function budgets(maxItems = SYNC_LIMITS.maxItemsPerJob) {
  return {
    maxItems,
    maxPages: 1_000,
    maxDurationMs: 3_600_000,
    maxItemBytes: SYNC_LIMITS.socialItemBytes,
    maxMediaPerItem: SYNC_LIMITS.mediaItems,
  };
}

function socialItem(
  index: number,
  source: SocialSource = 'x',
  overrides: Partial<SocialItem> = {},
): SocialItem {
  const sourceItemId =
    overrides.sourceItemId ??
    (source === 'x'
      ? (1_800_000_000_000_000_000n + BigInt(index)).toString()
      : `Wb${index.toString(36).padStart(6, '0')}`);
  const canonicalUrl =
    overrides.canonicalUrl ??
    (source === 'x'
      ? `https://x.com/example/status/${sourceItemId}`
      : `https://weibo.com/example/${sourceItemId}`);
  return {
    schemaVersion: 1,
    source,
    sourceItemId,
    canonicalUrl,
    title: `Item ${index}`,
    text: `Body ${index}`,
    capturedAt: timestamp(2),
    completeness: 'summary_only',
    media: [],
    contentHash: index.toString(16).padStart(64, '0'),
    extractorVersion: 1,
    ...overrides,
  };
}

function checkpoint(
  scannedCount: number,
  updatedAt: string,
  overrides: Partial<SyncCheckpoint> = {},
): SyncCheckpoint {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    scannedCount,
    acceptedCount: scannedCount,
    consecutiveKnownIds: 0,
    updatedAt,
    ...overrides,
  };
}

function catalogRecord(index: number): SyncRecord {
  const source: SocialSource = index % 2 === 0 ? 'x' : 'weibo';
  const sourceItemId =
    source === 'x'
      ? (1_700_000_000_000_000_000n + BigInt(index)).toString()
      : `Wr${index.toString(36).padStart(6, '0')}`;
  return {
    schemaVersion: 1,
    key: makeSyncRecordKey(source, sourceItemId),
    source,
    sourceItemId,
    canonicalUrl:
      source === 'x'
        ? `https://x.com/catalog/status/${sourceItemId}`
        : `https://weibo.com/catalog/${sourceItemId}`,
    contentHash: index.toString(16).padStart(64, '0'),
    relativePath: `Social/${source}/${index}.md`,
    completeness: 'summary_only',
    extractorVersion: 1,
    importedAt: timestamp(1),
    lastSeenAt: timestamp(2),
  };
}

async function createScanningJob(
  store: SyncStore,
  id = 'job-1',
  source: SocialSource = 'x',
): Promise<void> {
  await store.createJob({
    id,
    source,
    adapterVersion: 1,
    budgets: budgets(),
    createdAt: timestamp(0),
  });
  await store.transitionJob(id, 'scanning', timestamp(1));
}

function openNativeDatabase(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade?: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.addEventListener('upgradeneeded', () => upgrade?.(request.result));
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error));
    transaction.addEventListener('error', () => reject(transaction.error));
  });
}

function factoryWithBlockedOpen(factory: IDBFactory): IDBFactory {
  return new Proxy(factory, {
    get(target, property) {
      if (property === 'open') {
        return (name: string, version?: number) => {
          const request = target.open(name, version);
          queueMicrotask(() => {
            request.dispatchEvent(
              new IDBVersionChangeEvent('blocked', {
                oldVersion: 1,
                newVersion: version ?? null,
              }),
            );
          });
          return request;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('SyncStore database and jobs', () => {
  it('creates the isolated shuhai-sync schema v1 and exposes metadata', async () => {
    const factory = new IDBFactory();
    const store = await openSyncStore({ indexedDB: factory, dbName: 'sync-layout' });

    await expect(store.getMeta()).resolves.toEqual({
      key: 'schema',
      schemaVersion: 1,
      databaseVersion: 1,
    });
    await expect(store.listJobs()).resolves.toEqual([]);
    await expect(store.listRecords()).resolves.toEqual([]);
    await expect(store.listWriteIntents()).resolves.toEqual([]);
    store.close();
  });

  it('fails closed for newer versions and malformed schema-v1 layouts', async () => {
    const newerFactory = new IDBFactory();
    const newer = await openNativeDatabase(newerFactory, 'sync-newer', 2);
    newer.close();
    await expect(
      openSyncStore({ indexedDB: newerFactory, dbName: 'sync-newer' }),
    ).rejects.toMatchObject({
      code: 'unsupported_database_version',
    });

    const malformedFactory = new IDBFactory();
    const malformed = await openNativeDatabase(malformedFactory, 'sync-malformed', 1, (database) =>
      database.createObjectStore('jobs', { keyPath: 'id' }),
    );
    malformed.close();
    await expect(
      openSyncStore({ indexedDB: malformedFactory, dbName: 'sync-malformed' }),
    ).rejects.toMatchObject({
      code: 'invalid_database_layout',
    });
  });

  it('fails closed and reports when an IndexedDB open is blocked', async () => {
    const blockedEvents: Array<{ currentVersion: number; requestedVersion: number | null }> = [];
    await expect(
      openSyncStore({
        indexedDB: factoryWithBlockedOpen(new IDBFactory()),
        dbName: 'sync-blocked',
        onBlocked: (event) => blockedEvents.push(event),
      }),
    ).rejects.toMatchObject({ code: 'open_blocked' });
    expect(blockedEvents).toEqual([{ currentVersion: 1, requestedVersion: 1 }]);
  });

  it('closes the store on versionchange even when the observer throws', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-versionchange-close';
    let observed = 0;
    const store = await openSyncStore({
      indexedDB: factory,
      dbName,
      onBlocking: () => {
        observed += 1;
        throw new Error('observer failure');
      },
    });

    const upgraded = await openNativeDatabase(factory, dbName, 2);
    expect(observed).toBe(1);
    await expect(store.getMeta()).rejects.toMatchObject({ code: 'transaction_failed' });
    upgraded.close();
  });

  it('rejects corrupt persisted rows instead of casting or defaulting them', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-corrupt-row';
    const store = await openSyncStore({ indexedDB: factory, dbName });
    await store.createJob({
      id: 'job-corrupt',
      source: 'x',
      adapterVersion: 1,
      budgets: budgets(),
      createdAt: timestamp(0),
    });

    const native = await openNativeDatabase(factory, dbName, 1);
    const transaction = native.transaction('jobs', 'readwrite');
    transaction.objectStore('jobs').put({
      id: 'job-corrupt',
      source: 'x',
      status: 'prepared',
      activeSource: 'x',
      unexpected: true,
    });
    await transactionDone(transaction);
    native.close();

    await expect(store.getJob('job-corrupt')).rejects.toBeInstanceOf(CorruptSyncRowError);
    store.close();
  });

  it('rejects hostile direct job inputs without invoking accessors', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-hostile-direct-input',
    });
    let accessorInvoked = false;
    const hostileBudgets: Record<string, unknown> = {
      maxPages: 1,
      maxDurationMs: 1_000,
      maxItemBytes: SYNC_LIMITS.socialItemBytes,
      maxMediaPerItem: 0,
    };
    Object.defineProperty(hostileBudgets, 'maxItems', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return 1;
      },
    });

    await expect(
      store.createJob({
        id: 'hostile-job',
        source: 'x',
        adapterVersion: 1,
        budgets: hostileBudgets as unknown as ReturnType<typeof budgets>,
        createdAt: timestamp(0),
      }),
    ).rejects.toBeTruthy();
    expect(accessorInvoked).toBe(false);
    await expect(store.listJobs()).resolves.toEqual([]);
    store.close();
  });

  it('enforces the state machine and one active job per source', async () => {
    const factory = new IDBFactory();
    const store = await openSyncStore({ indexedDB: factory, dbName: 'sync-active-jobs' });
    const input = {
      id: 'job-x-1',
      source: 'x' as const,
      adapterVersion: 1,
      budgets: budgets(),
      createdAt: timestamp(0),
    };

    const first = await store.createJob(input);
    await expect(store.createJob(input)).resolves.toEqual(first);
    await expect(store.createJob({ ...input, id: 'job-x-2' })).rejects.toBeInstanceOf(
      ActiveSyncJobExistsError,
    );
    await expect(store.transitionJob('job-x-1', 'writing', timestamp(1))).rejects.toBeInstanceOf(
      InvalidSyncJobTransitionError,
    );

    await store.createJob({ ...input, id: 'job-weibo-1', source: 'weibo' });
    await store.transitionJob('job-x-1', 'scanning', timestamp(1));
    await store.transitionJob('job-x-1', 'cancelled', timestamp(2));
    await expect(store.createJob({ ...input, id: 'job-x-2' })).resolves.toMatchObject({
      id: 'job-x-2',
      status: 'prepared',
    });
    await expect(store.listJobs({ source: 'x' })).resolves.toHaveLength(2);
    store.close();
  });

  it('resumes a paused job only in its persisted pre- or post-review phase', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-paused-phase',
    });
    await createScanningJob(store);
    await store.transitionJob('job-1', 'paused', timestamp(2));
    await expect(store.transitionJob('job-1', 'writing', timestamp(3))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await store.transitionJob('job-1', 'scanning', timestamp(3));

    const item = socialItem(99);
    await store.putJobItem('job-1', item, checkpoint(1, timestamp(4)));
    await store.updateJobItemClassification('job-1', item.sourceItemId, 'new', timestamp(5));
    await store.transitionJob('job-1', 'ready_for_review', timestamp(6));
    await expect(store.transitionJob('job-1', 'writing', timestamp(7))).resolves.toMatchObject({
      writeAuthorizedAt: timestamp(7),
    });
    await store.transitionJob('job-1', 'paused', timestamp(8));
    await expect(store.transitionJob('job-1', 'scanning', timestamp(9))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(store.transitionJob('job-1', 'writing', timestamp(9))).resolves.toMatchObject({
      writeAuthorizedAt: timestamp(7),
    });
    store.close();
  });
});

describe('SyncStore checkpoint and item recovery', () => {
  it('atomically persists checkpoints, rolls back interrupted batches, and deduplicates replay', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-checkpoint-replay';
    let store = await openSyncStore({ indexedDB: factory, dbName });
    await createScanningJob(store);
    const first = socialItem(1);
    const second = socialItem(2);
    const third = socialItem(3);
    let checkpointAccessorInvoked = false;
    const hostileCheckpoint: Record<string, unknown> = {
      schemaVersion: 1,
      adapterVersion: 1,
      scannedCount: 0,
      acceptedCount: 0,
      consecutiveKnownIds: 0,
    };
    Object.defineProperty(hostileCheckpoint, 'updatedAt', {
      enumerable: true,
      get: () => {
        checkpointAccessorInvoked = true;
        return timestamp(2);
      },
    });

    await expect(store.putScanBatch('job-1', [], hostileCheckpoint)).rejects.toBeTruthy();
    expect(checkpointAccessorInvoked).toBe(false);

    await expect(
      store.putScanBatch('job-1', {} as unknown as readonly unknown[], checkpoint(0, timestamp(2))),
    ).rejects.toThrow(TypeError);

    await expect(
      store.putScanBatch(
        'job-1',
        [first, second],
        checkpoint(2, timestamp(2), { cursor: 'page-1' }),
      ),
    ).resolves.toMatchObject({ inserted: 2, existing: 0 });

    await expect(
      store.putScanBatch(
        'job-1',
        [third, { ...first, title: 'Conflicting replay' }],
        checkpoint(4, timestamp(3), { cursor: 'page-2' }),
      ),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.listJobItems('job-1')).resolves.toHaveLength(2);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      checkpoint: { scannedCount: 2, cursor: 'page-1' },
      summary: { uniqueItemCount: 2, pendingReviewCount: 2 },
    });

    store.close();
    store = await openSyncStore({ indexedDB: factory, dbName });
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'scanning',
      checkpoint: { scannedCount: 2, cursor: 'page-1' },
    });
    await expect(
      store.putScanBatch(
        'job-1',
        [first, second, third],
        checkpoint(5, timestamp(4), { cursor: 'page-2', consecutiveKnownIds: 2 }),
      ),
    ).resolves.toMatchObject({ inserted: 1, existing: 2 });
    await expect(store.listJobItems('job-1')).resolves.toHaveLength(3);
    await expect(store.getCheckpoint('job-1')).resolves.toMatchObject({
      scannedCount: 5,
      cursor: 'page-2',
    });
    await expect(
      store.putCheckpoint(
        'job-1',
        checkpoint(6, timestamp(5), { acceptedCount: 5, cursor: 'page-2' }),
      ),
    ).resolves.toMatchObject({ checkpoint: { scannedCount: 6, acceptedCount: 5 } });
    await expect(store.putCheckpoint('job-1', checkpoint(5, timestamp(6)))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    store.close();
  });

  it('does not let out-of-order item decisions move the job timestamp backwards', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-classification-time',
    });
    await createScanningJob(store);
    const first = socialItem(20);
    const second = socialItem(21);
    await store.putScanBatch('job-1', [first, second], checkpoint(2, timestamp(2)));
    await store.updateJobItemClassification('job-1', first.sourceItemId, 'new', timestamp(4));
    await expect(
      store.updateJobItemClassification('job-1', second.sourceItemId, 'new', timestamp(3)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      updatedAt: timestamp(4),
      summary: { pendingReviewCount: 1 },
    });
    store.close();
  });
});

describe('SyncStore write intents', () => {
  it('reopens with a pending intent and atomically commits record, item, summary, and intent removal', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-intent-commit';
    let store = await openSyncStore({ indexedDB: factory, dbName });
    await createScanningJob(store);
    const item = socialItem(7, 'x', { contentHash: HASH });
    await store.putJobItem('job-1', item, checkpoint(1, timestamp(2)));
    await store.updateJobItemClassification('job-1', item.sourceItemId, 'new', timestamp(3));
    await store.transitionJob('job-1', 'ready_for_review', timestamp(4));
    await store.transitionJob('job-1', 'writing', timestamp(5));
    await store.putWriteIntent({
      id: 'intent-1',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-7.md',
      createdAt: timestamp(6),
    });
    await expect(store.getJobItem('job-1', item.sourceItemId)).resolves.toMatchObject({
      writeStatus: 'pending',
    });
    store.close();

    store = await openSyncStore({ indexedDB: factory, dbName });
    await expect(store.listWriteIntents({ jobId: 'job-1' })).resolves.toHaveLength(1);
    let outcomeAccessorInvoked = false;
    const hostileOutcome: Record<string, unknown> = {
      status: 'created',
      bytes: 10,
    };
    Object.defineProperty(hostileOutcome, 'relativePath', {
      enumerable: true,
      get: () => {
        outcomeAccessorInvoked = true;
        return 'Social/x/item-7.md';
      },
    });
    await expect(
      store.commitWriteIntent('intent-1', hostileOutcome, timestamp(7)),
    ).rejects.toBeTruthy();
    expect(outcomeAccessorInvoked).toBe(false);
    await expect(
      store.commitWriteIntent(
        'intent-1',
        { status: 'created', relativePath: 'Social/x/wrong.md', bytes: 10 },
        timestamp(7),
      ),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getWriteIntent('intent-1')).resolves.toBeDefined();
    await expect(
      store.getRecordByKey(makeSyncRecordKey('x', item.sourceItemId)),
    ).resolves.toBeUndefined();
    await expect(store.getJobItem('job-1', item.sourceItemId)).resolves.toMatchObject({
      writeStatus: 'pending',
    });

    const committed = await store.commitWriteIntent(
      'intent-1',
      { status: 'created', relativePath: 'Social/x/item-7.md', bytes: 42 },
      timestamp(8),
    );
    expect(committed).toMatchObject({
      job: { summary: { writePendingCount: 0, createdCount: 1 } },
      item: { writeStatus: 'created', outcome: { status: 'created', bytes: 42 } },
      record: { key: makeSyncRecordKey('x', item.sourceItemId) },
    });
    await expect(store.getWriteIntent('intent-1')).resolves.toBeUndefined();
    await expect(store.getRecordByCanonicalUrl(item.canonicalUrl)).resolves.toMatchObject({
      sourceItemId: item.sourceItemId,
    });
    await expect(store.getRecordByContentHash(item.contentHash)).resolves.toMatchObject({
      sourceItemId: item.sourceItemId,
    });
    await expect(store.transitionJob('job-1', 'complete', timestamp(9))).resolves.toMatchObject({
      status: 'complete',
    });
    store.close();
  });

  it('rejects false completion and supports an explicit error retry', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-intent-retry',
    });
    await createScanningJob(store);
    const item = socialItem(8, 'x', { contentHash: HASH });
    await store.putJobItem('job-1', item, checkpoint(1, timestamp(2)));
    await store.updateJobItemClassification('job-1', item.sourceItemId, 'new', timestamp(3));
    await store.transitionJob('job-1', 'ready_for_review', timestamp(4));
    await store.transitionJob('job-1', 'writing', timestamp(5));

    await expect(store.transitionJob('job-1', 'complete', timestamp(6))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(store.transitionJob('job-1', 'partial', timestamp(6))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await store.putWriteIntent({
      id: 'intent-error',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-8.md',
      createdAt: timestamp(7),
    });
    await store.commitWriteIntent(
      'intent-error',
      { status: 'error', relativePath: 'Social/x/item-8.md', code: 'permission_denied' },
      timestamp(8),
    );
    await expect(
      store.putWriteIntent({
        id: 'intent-unauthorized-retry',
        jobId: 'job-1',
        sourceItemId: item.sourceItemId,
        relativePath: 'Social/x/item-8.md',
        createdAt: timestamp(9),
      }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'writing',
      summary: { errorCount: 1, writePendingCount: 0 },
    });
    await expect(store.getJobItem('job-1', item.sourceItemId)).resolves.toMatchObject({
      writeStatus: 'error',
    });
    await store.transitionJob('job-1', 'partial', timestamp(9));
    await store.transitionJob('job-1', 'writing', timestamp(10));

    await expect(
      store.putWriteIntent({
        id: 'intent-different-path',
        jobId: 'job-1',
        sourceItemId: item.sourceItemId,
        relativePath: 'Social/x/different-item-8.md',
        createdAt: timestamp(11),
      }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await store.putWriteIntent({
      id: 'intent-retry',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-8.md',
      createdAt: timestamp(11),
    });
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      summary: { errorCount: 0, writePendingCount: 1 },
    });
    const retriedItem = await store.getJobItem('job-1', item.sourceItemId);
    expect(retriedItem).toMatchObject({ writeStatus: 'pending' });
    expect(retriedItem).not.toHaveProperty('outcome');
    await store.commitWriteIntent(
      'intent-retry',
      { status: 'created', relativePath: 'Social/x/item-8.md', bytes: 42 },
      timestamp(12),
    );
    await expect(store.transitionJob('job-1', 'complete', timestamp(13))).resolves.toMatchObject({
      status: 'complete',
      summary: { createdCount: 1, errorCount: 0 },
    });
    store.close();
  });

  it('rejects partial while another item still has a pending write intent', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-partial-pending-intent',
    });
    await createScanningJob(store);
    const failedItem = socialItem(18, 'x');
    const pendingItem = socialItem(19, 'x');
    await store.putScanBatch('job-1', [failedItem, pendingItem], checkpoint(2, timestamp(2)));
    await store.updateJobItemClassification('job-1', failedItem.sourceItemId, 'new', timestamp(3));
    await store.updateJobItemClassification('job-1', pendingItem.sourceItemId, 'new', timestamp(3));
    await store.transitionJob('job-1', 'ready_for_review', timestamp(4));
    await store.transitionJob('job-1', 'writing', timestamp(5));
    await store.putWriteIntent({
      id: 'intent-failed-item',
      jobId: 'job-1',
      sourceItemId: failedItem.sourceItemId,
      relativePath: 'Social/x/failed-item.md',
      createdAt: timestamp(6),
    });
    await store.commitWriteIntent(
      'intent-failed-item',
      { status: 'error', relativePath: 'Social/x/failed-item.md', code: 'write_failed' },
      timestamp(7),
    );
    await store.putWriteIntent({
      id: 'intent-pending-item',
      jobId: 'job-1',
      sourceItemId: pendingItem.sourceItemId,
      relativePath: 'Social/x/pending-item.md',
      createdAt: timestamp(8),
    });

    await expect(store.transitionJob('job-1', 'partial', timestamp(9))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'writing',
      summary: { errorCount: 1, writePendingCount: 1 },
    });
    store.close();
  });

  it('does not let a delayed write commit move job timestamps backwards', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-stale-write-commit',
    });
    await createScanningJob(store);
    const item = socialItem(9, 'x', { contentHash: HASH });
    await store.putJobItem('job-1', item, checkpoint(1, timestamp(2)));
    await store.updateJobItemClassification('job-1', item.sourceItemId, 'new', timestamp(3));
    await store.transitionJob('job-1', 'ready_for_review', timestamp(4));
    await store.transitionJob('job-1', 'writing', timestamp(5));
    await store.putWriteIntent({
      id: 'intent-stale',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-9.md',
      createdAt: timestamp(6),
    });
    await store.transitionJob('job-1', 'paused', timestamp(7));

    await expect(
      store.commitWriteIntent(
        'intent-stale',
        { status: 'created', relativePath: 'Social/x/item-9.md', bytes: 42 },
        timestamp(6),
      ),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getWriteIntent('intent-stale')).resolves.toBeDefined();
    await expect(
      store.commitWriteIntent(
        'intent-stale',
        { status: 'created', relativePath: 'Social/x/item-9.md', bytes: 42 },
        timestamp(8),
      ),
    ).resolves.toMatchObject({ job: { updatedAt: timestamp(8) } });
    store.close();
  });
});

describe('SyncStore catalog scale', () => {
  it('does not let catalog lastSeenAt move backwards', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-record-monotonic',
    });
    const record = catalogRecord(42);
    await expect(store.putRecords({} as unknown as readonly unknown[])).rejects.toThrow(TypeError);
    await store.putRecord(record);
    await expect(
      store.putRecord({ ...record, lastSeenAt: record.importedAt }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    store.close();
  });

  it.each([100, 1_000, 10_000])(
    'deduplicates and queries %i catalog records within the fixed budgets',
    async (count) => {
      const factory = new IDBFactory();
      const store = await openSyncStore({ indexedDB: factory, dbName: `sync-records-${count}` });
      const records = Array.from({ length: count }, (_, index) => catalogRecord(index));
      const fixtureBytes = new TextEncoder().encode(JSON.stringify(records)).byteLength;
      expect(fixtureBytes).toBeLessThanOrEqual(FIXTURE_MEMORY_BUDGET);

      const startedAt = performance.now();
      await expect(store.putRecords(records, { mode: 'insert' })).resolves.toEqual({
        inserted: count,
        updated: 0,
      });
      await expect(store.listRecords({ limit: count })).resolves.toHaveLength(count);
      const sample = records[count - 1]!;
      await expect(store.getRecordByKey(sample.key)).resolves.toEqual(sample);
      await expect(store.getRecordByCanonicalUrl(sample.canonicalUrl)).resolves.toEqual(sample);
      await expect(store.getRecordByContentHash(sample.contentHash)).resolves.toEqual(sample);
      expect(performance.now() - startedAt).toBeLessThan(10_000);

      await expect(store.putRecords([sample], { mode: 'insert' })).rejects.toBeTruthy();
      await expect(store.listRecords({ limit: count })).resolves.toHaveLength(count);
      store.close();
    },
    20_000,
  );
});
