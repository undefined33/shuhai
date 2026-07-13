import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  ActiveSyncJobExistsError,
  CorruptSyncRowError,
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
    scanRevision: 1,
    scannedCount,
    acceptedCount: scannedCount,
    acceptedBytes: scannedCount * 1_024,
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
  await store.claimScanRevision(id, 0, timestamp(1));
}

async function persistScanBatch(
  store: SyncStore,
  jobId: string,
  items: readonly SocialItem[],
  nextCheckpoint: SyncCheckpoint,
) {
  return store.putScanBatch(jobId, nextCheckpoint.scanRevision, items, nextCheckpoint);
}

async function classifyItem(
  store: SyncStore,
  jobId: string,
  sourceItemId: string,
  classification: 'new' | 'existing' | 'changed' | 'incomplete' | 'error',
  updatedAt: string,
) {
  const job = await store.getJob(jobId);
  if (!job) {
    throw new Error('Test job missing');
  }
  return store.updateJobItemClassification(
    jobId,
    sourceItemId,
    classification,
    job.scanRevision,
    updatedAt,
  );
}

async function prepareWritingJob(
  store: SyncStore,
  jobId: string,
  selectedSourceItemIds: readonly string[],
  finishAt: string,
  selectAt: string,
  authorizeAt: string,
) {
  const scanning = await store.getJob(jobId);
  if (!scanning) {
    throw new Error('Test job missing');
  }
  await store.finishScan(jobId, scanning.scanRevision, finishAt);
  const selection = await store.saveReviewSelection(jobId, 0, selectedSourceItemIds, selectAt);
  return store.authorizeReviewSelection(
    jobId,
    selection.job.reviewRevision,
    selectedSourceItemIds,
    authorizeAt,
  );
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

function createLegacyV1Layout(database: IDBDatabase): void {
  const jobs = database.createObjectStore('jobs', { keyPath: 'id' });
  jobs.createIndex('by-source', 'source');
  jobs.createIndex('by-status', 'status');
  jobs.createIndex('by-active-source', 'activeSource', { unique: true });

  const items = database.createObjectStore('items', { keyPath: 'key' });
  items.createIndex('by-job-id', 'jobId');
  items.createIndex('by-job-source-item', ['jobId', 'sourceItemId'], { unique: true });
  items.createIndex('by-job-classification', ['jobId', 'classification']);
  items.createIndex('by-job-write-status', ['jobId', 'writeStatus']);

  const records = database.createObjectStore('records', { keyPath: 'key' });
  records.createIndex('by-source', 'source');
  records.createIndex('by-canonical-url', 'canonicalUrl');
  records.createIndex('by-content-hash', 'contentHash');

  const intents = database.createObjectStore('intents', { keyPath: 'id' });
  intents.createIndex('by-job-id', 'jobId');
  intents.createIndex('by-item-key', 'itemKey', { unique: true });
  intents.createIndex('by-record-key', 'recordKey');

  const meta = database.createObjectStore('meta', { keyPath: 'key' });
  meta.put({ key: 'schema', schemaVersion: 1, databaseVersion: 1 });
}

async function seedLegacyV1Database(
  factory: IDBFactory,
  dbName: string,
  rows: Partial<Record<'jobs' | 'items' | 'records' | 'intents', readonly unknown[]>>,
): Promise<void> {
  const database = await openNativeDatabase(factory, dbName, 1, createLegacyV1Layout);
  const storeNames = Object.keys(rows) as Array<'jobs' | 'items' | 'records' | 'intents'>;
  if (storeNames.length > 0) {
    const transaction = database.transaction(storeNames, 'readwrite');
    for (const storeName of storeNames) {
      for (const row of rows[storeName] ?? []) {
        transaction.objectStore(storeName).put(row);
      }
    }
    await transactionDone(transaction);
  }
  database.close();
}

function legacyJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const job: Record<string, unknown> = {
    schemaVersion: 1,
    id: 'legacy-job',
    source: 'x',
    status: 'scanning',
    adapterVersion: 1,
    createdAt: timestamp(0),
    updatedAt: timestamp(2),
    checkpoint: {
      schemaVersion: 1,
      adapterVersion: 1,
      scannedCount: 1,
      acceptedCount: 1,
      consecutiveKnownIds: 0,
      updatedAt: timestamp(2),
    },
    budgets: budgets(),
    summary: {
      scannedCount: 1,
      uniqueItemCount: 1,
      pendingReviewCount: 0,
      writePendingCount: 0,
      createdCount: 0,
      alreadyExistsCount: 0,
      skippedCount: 0,
      errorCount: 0,
    },
    activeSource: 'x',
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete job[key];
    }
  }
  return job;
}

function legacyItem(
  item: SocialItem,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: `${'legacy-job'.length}:legacy-job:${item.sourceItemId}`,
    schemaVersion: 1,
    jobId: 'legacy-job',
    sourceItemId: item.sourceItemId,
    item,
    classification: 'new',
    writeStatus: 'not_requested',
    discoveredAt: timestamp(2),
    updatedAt: timestamp(2),
    ...overrides,
  };
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
  it('creates the isolated shuhai-sync schema v2 and exposes metadata', async () => {
    const factory = new IDBFactory();
    const store = await openSyncStore({ indexedDB: factory, dbName: 'sync-layout' });

    await expect(store.getMeta()).resolves.toEqual({
      key: 'schema',
      schemaVersion: 1,
      databaseVersion: 2,
    });
    await expect(store.listJobs()).resolves.toEqual([]);
    await expect(store.listRecords()).resolves.toEqual([]);
    await expect(store.listWriteIntents()).resolves.toEqual([]);
    store.close();
  });

  it('fails closed for newer versions and malformed schema-v1 layouts', async () => {
    const newerFactory = new IDBFactory();
    const newer = await openNativeDatabase(newerFactory, 'sync-newer', 3);
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
    expect(blockedEvents).toEqual([{ currentVersion: 1, requestedVersion: 2 }]);
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

    const upgraded = await openNativeDatabase(factory, dbName, 3);
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

    const native = await openNativeDatabase(factory, dbName, 2);
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
      SyncStoreConflictError,
    );

    await store.createJob({ ...input, id: 'job-weibo-1', source: 'weibo' });
    await store.claimScanRevision('job-x-1', 0, timestamp(1));
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
    await store.pauseJobWithStopRecord('job-1', 1, 'user_paused', 'scanning', timestamp(2));
    await expect(
      store.authorizeReviewSelection('job-1', 0, [], timestamp(3)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await store.claimScanRevision('job-1', 1, timestamp(3));

    const item = socialItem(99);
    const resumedCheckpoint = checkpoint(1, timestamp(4), { scanRevision: 2 });
    await store.putJobItem('job-1', 2, item, resumedCheckpoint);
    await store.updateJobItemClassification('job-1', item.sourceItemId, 'new', 2, timestamp(5));
    await store.finishScan('job-1', 2, timestamp(6));
    await store.saveReviewSelection('job-1', 0, [item.sourceItemId], timestamp(7));
    await expect(
      store.authorizeReviewSelection('job-1', 1, [item.sourceItemId], timestamp(8)),
    ).resolves.toMatchObject({
      writeAuthorizedAt: timestamp(8),
    });
    await store.pauseJobWithStopRecord('job-1', 2, 'user_paused', 'writing', timestamp(9));
    await expect(store.claimScanRevision('job-1', 2, timestamp(10))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(
      store.authorizeReviewSelection('job-1', 1, [item.sourceItemId], timestamp(10)),
    ).resolves.toMatchObject({ writeAuthorizedAt: timestamp(10) });
    store.close();
  });

  it('rolls back the terminal scan transition when its commit guard expires', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-finish-commit-guard',
    });
    await createScanningJob(store);
    const item = socialItem(100);
    await persistScanBatch(store, 'job-1', [item], checkpoint(1, timestamp(2)));
    await classifyItem(store, 'job-1', item.sourceItemId, 'new', timestamp(3));

    await expect(
      store.finishScan('job-1', 1, timestamp(4), { beforeCommit: () => false }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'scanning',
      scanRevision: 1,
      summary: { uniqueItemCount: 1, pendingReviewCount: 0 },
    });
    store.close();
  });
});

describe('SyncStore v1 to v2 migration', () => {
  it('migrates interrupted scanning data as unreviewed and explicitly paused', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-scanning';
    const item = socialItem(301);
    await seedLegacyV1Database(factory, dbName, {
      jobs: [legacyJob()],
      items: [legacyItem(item)],
    });

    const store = await openSyncStore({ indexedDB: factory, dbName });
    await expect(store.getMeta()).resolves.toEqual({
      key: 'schema',
      schemaVersion: 1,
      databaseVersion: 2,
    });
    await expect(store.getJob('legacy-job')).resolves.toMatchObject({
      status: 'paused',
      scanRevision: 0,
      reviewRevision: 0,
      stopRecord: {
        code: 'worker_interrupted',
        phase: 'scanning',
        scanRevision: 0,
      },
      checkpoint: { scanRevision: 0 },
      summary: { unreviewedCount: 1, selectedCount: 0, excludedCount: 0 },
    });
    await expect(store.getJobItem('legacy-job', item.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'unreviewed',
      reviewRevision: 0,
      writeStatus: 'not_requested',
    });
    store.close();
  });

  it('preserves terminal history without making excluded items writable', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-terminal';
    const written = socialItem(302);
    const excluded = socialItem(303);
    const relativePath = 'Social/x/legacy-written.md';
    const record: SyncRecord = {
      schemaVersion: 1,
      key: makeSyncRecordKey('x', written.sourceItemId),
      source: 'x',
      sourceItemId: written.sourceItemId,
      canonicalUrl: written.canonicalUrl,
      contentHash: written.contentHash,
      relativePath,
      completeness: written.completeness,
      extractorVersion: written.extractorVersion,
      importedAt: timestamp(2),
      lastSeenAt: timestamp(2),
    };
    await seedLegacyV1Database(factory, dbName, {
      jobs: [
        legacyJob({
          status: 'cancelled',
          activeSource: undefined,
          writeAuthorizedAt: timestamp(2),
          checkpoint: {
            schemaVersion: 1,
            adapterVersion: 1,
            scannedCount: 2,
            acceptedCount: 2,
            consecutiveKnownIds: 0,
            updatedAt: timestamp(2),
          },
          summary: {
            scannedCount: 2,
            uniqueItemCount: 2,
            pendingReviewCount: 0,
            writePendingCount: 0,
            createdCount: 1,
            alreadyExistsCount: 0,
            skippedCount: 0,
            errorCount: 0,
          },
        }),
      ],
      items: [
        legacyItem(written, {
          writeStatus: 'created',
          outcome: { status: 'created', relativePath, bytes: 42 },
        }),
        legacyItem(excluded, {
          key: `${'legacy-job'.length}:legacy-job:${excluded.sourceItemId}`,
          sourceItemId: excluded.sourceItemId,
          item: excluded,
        }),
      ],
      records: [record],
    });

    const store = await openSyncStore({ indexedDB: factory, dbName });
    await expect(store.getJob('legacy-job')).resolves.toMatchObject({
      status: 'cancelled',
      reviewRevision: 1,
      authorizedReviewRevision: 1,
      summary: { selectedCount: 1, excludedCount: 1, unreviewedCount: 0 },
    });
    await expect(store.getJobItem('legacy-job', written.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'selected',
      reviewRevision: 1,
      writeStatus: 'created',
    });
    await expect(store.getJobItem('legacy-job', excluded.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'excluded',
      reviewRevision: 1,
      writeStatus: 'not_requested',
    });
    store.close();
  });

  it('atomically aborts unsafe active writes and leaves the v1 database unchanged', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-active-write';
    const item = socialItem(304);
    await seedLegacyV1Database(factory, dbName, {
      jobs: [
        legacyJob({
          status: 'writing',
          writeAuthorizedAt: timestamp(2),
          summary: {
            scannedCount: 1,
            uniqueItemCount: 1,
            pendingReviewCount: 0,
            writePendingCount: 1,
            createdCount: 0,
            alreadyExistsCount: 0,
            skippedCount: 0,
            errorCount: 0,
          },
        }),
      ],
      items: [legacyItem(item, { writeStatus: 'pending' })],
    });

    await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
      code: 'unsafe_migration_state',
    });
    const raw = await openNativeDatabase(factory, dbName, 1);
    expect(raw.version).toBe(1);
    const transaction = raw.transaction(['jobs', 'meta'], 'readonly');
    const done = transactionDone(transaction);
    await expect(
      new Promise((resolve, reject) => {
        const request = transaction.objectStore('jobs').get('legacy-job');
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error));
      }),
    ).resolves.toMatchObject({ status: 'writing' });
    await done;
    raw.close();
  });

  it('aborts before parsing oversized v1 content and preserves version 1', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-byte-budget';
    await seedLegacyV1Database(factory, dbName, {
      records: [{ key: 'oversized', payload: 'x'.repeat(16 * MIB + 1) }],
    });
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    try {
      await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
        code: 'migration_budget_exceeded',
      });
      expect(getAllSpy).not.toHaveBeenCalled();
      const raw = await openNativeDatabase(factory, dbName, 1);
      expect(raw.version).toBe(1);
      raw.close();
    } finally {
      getAllSpy.mockRestore();
    }
  });

  it('bounds cumulative zero-byte container nodes before retaining all v1 rows', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-structure-budget';
    const rows = Array.from({ length: 123 }, (_, index) => ({
      key: `wide-${index}`,
      payload: Array.from({ length: 4_090 }, () => null),
    }));
    await seedLegacyV1Database(factory, dbName, { records: rows });

    await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
      code: 'migration_budget_exceeded',
    });
    const raw = await openNativeDatabase(factory, dbName, 1);
    expect(raw.version).toBe(1);
    raw.close();
  }, 20_000);

  it('rejects any unresolved v1 intent without inspecting its payload', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-unresolved-intent';
    await seedLegacyV1Database(factory, dbName, {
      intents: [{ id: 'legacy-intent', unexpected: 'untrusted' }],
    });

    await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
      code: 'unsafe_migration_state',
    });
    const raw = await openNativeDatabase(factory, dbName, 1);
    expect(raw.version).toBe(1);
    raw.close();
  });

  it('rejects unknown v1 fields instead of silently dropping them', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-unknown-field';
    await seedLegacyV1Database(factory, dbName, {
      jobs: [legacyJob({ unexpectedAuthorization: true })],
    });

    await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
      code: 'unsafe_migration_state',
    });
    const raw = await openNativeDatabase(factory, dbName, 1);
    expect(raw.version).toBe(1);
    raw.close();
  });

  it('aborts when the v1 row-count migration budget is exceeded', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-migrate-row-budget';
    const rows = Array.from({ length: 30_000 }, (_, index) => ({ key: `row-${index}` }));
    await seedLegacyV1Database(factory, dbName, { records: rows });

    await expect(openSyncStore({ indexedDB: factory, dbName })).rejects.toMatchObject({
      code: 'migration_budget_exceeded',
    });
    const raw = await openNativeDatabase(factory, dbName, 1);
    expect(raw.version).toBe(1);
    raw.close();
  }, 20_000);
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
    let batchAccessorInvoked = false;
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
    const hostileBatch: unknown[] = [];
    Object.defineProperty(hostileBatch, '0', {
      enumerable: true,
      get: () => {
        batchAccessorInvoked = true;
        return first;
      },
    });

    await expect(store.putScanBatch('job-1', 1, [], hostileCheckpoint)).rejects.toBeTruthy();
    expect(checkpointAccessorInvoked).toBe(false);
    await expect(
      store.putScanBatch('job-1', 1, hostileBatch, checkpoint(1, timestamp(2))),
    ).rejects.toBeTruthy();
    expect(batchAccessorInvoked).toBe(false);

    await expect(
      store.putScanBatch(
        'job-1',
        1,
        {} as unknown as readonly unknown[],
        checkpoint(0, timestamp(2)),
      ),
    ).rejects.toThrow(TypeError);

    await expect(
      store.putScanBatch(
        'job-1',
        1,
        [first, second],
        checkpoint(2, timestamp(2), { cursor: 'page-1' }),
      ),
    ).resolves.toMatchObject({ inserted: 2, existing: 0 });

    await expect(
      store.putScanBatch(
        'job-1',
        1,
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
    await expect(store.recoverInterruptedScanningJobs(timestamp(4))).resolves.toHaveLength(1);
    await expect(store.claimScanRevision('job-1', 1, timestamp(5))).resolves.toMatchObject({
      status: 'scanning',
      scanRevision: 2,
      checkpoint: { scannedCount: 2, cursor: 'page-1', scanRevision: 2 },
    });
    await expect(
      store.putScanBatch('job-1', 1, [third], checkpoint(3, timestamp(6), { scanRevision: 1 })),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(
      store.putScanBatch(
        'job-1',
        2,
        [first, second, third],
        checkpoint(5, timestamp(6), {
          scanRevision: 2,
          cursor: 'page-2',
          consecutiveKnownIds: 2,
        }),
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
        2,
        checkpoint(6, timestamp(7), {
          scanRevision: 2,
          acceptedCount: 5,
          cursor: 'page-2',
        }),
      ),
    ).resolves.toMatchObject({ checkpoint: { scannedCount: 6, acceptedCount: 5 } });
    await expect(
      store.putCheckpoint('job-1', 2, checkpoint(5, timestamp(8), { scanRevision: 2 })),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
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
    await persistScanBatch(store, 'job-1', [first, second], checkpoint(2, timestamp(2)));
    await classifyItem(store, 'job-1', first.sourceItemId, 'new', timestamp(4));
    await expect(
      classifyItem(store, 'job-1', second.sourceItemId, 'new', timestamp(3)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      updatedAt: timestamp(4),
      summary: { pendingReviewCount: 1 },
    });
    store.close();
  });
});

describe('SyncStore persisted review selection', () => {
  it('binds exact selected IDs to a monotonic revision across reopen', async () => {
    const factory = new IDBFactory();
    const dbName = 'sync-review-selection';
    let store = await openSyncStore({ indexedDB: factory, dbName });
    await createScanningJob(store);
    const selectedItem = socialItem(401);
    const excludedItem = socialItem(402);
    await persistScanBatch(
      store,
      'job-1',
      [selectedItem, excludedItem],
      checkpoint(2, timestamp(2)),
    );
    await classifyItem(store, 'job-1', selectedItem.sourceItemId, 'new', timestamp(3));
    await classifyItem(store, 'job-1', excludedItem.sourceItemId, 'existing', timestamp(3));
    await store.finishScan('job-1', 1, timestamp(4));

    let selectionAccessorInvoked = false;
    const hostileSelection: string[] = [];
    Object.defineProperty(hostileSelection, '0', {
      enumerable: true,
      get: () => {
        selectionAccessorInvoked = true;
        return selectedItem.sourceItemId;
      },
    });
    await expect(
      store.saveReviewSelection('job-1', 0, hostileSelection, timestamp(5)),
    ).rejects.toBeTruthy();
    expect(selectionAccessorInvoked).toBe(false);

    await expect(
      store.saveReviewSelection(
        'job-1',
        0,
        [selectedItem.sourceItemId, selectedItem.sourceItemId],
        timestamp(5),
      ),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(
      store.saveReviewSelection('job-1', 0, ['9999999999999999999'], timestamp(5)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(
      store.saveReviewSelection('job-1', 0, [excludedItem.sourceItemId], timestamp(5)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);

    const saved = await store.saveReviewSelection(
      'job-1',
      0,
      [selectedItem.sourceItemId],
      timestamp(5),
    );
    expect(saved.job).toMatchObject({
      reviewRevision: 1,
      summary: { selectedCount: 1, excludedCount: 1, unreviewedCount: 0 },
    });
    store.close();

    store = await openSyncStore({ indexedDB: factory, dbName });
    await expect(store.getJobItem('job-1', selectedItem.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'selected',
      reviewRevision: 1,
    });
    await expect(store.getJobItem('job-1', excludedItem.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'excluded',
      reviewRevision: 1,
    });
    await expect(
      store.saveReviewSelection('job-1', 0, [selectedItem.sourceItemId], timestamp(6)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(
      store.authorizeReviewSelection('job-1', 1, [], timestamp(6)),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await store.authorizeReviewSelection('job-1', 1, [selectedItem.sourceItemId], timestamp(6));
    await expect(
      store.putWriteIntent({
        id: 'intent-excluded',
        jobId: 'job-1',
        sourceItemId: excludedItem.sourceItemId,
        relativePath: 'Social/x/excluded.md',
        reviewRevision: 1,
        createdAt: timestamp(7),
      }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(
      store.putWriteIntent({
        id: 'intent-selected',
        jobId: 'job-1',
        sourceItemId: selectedItem.sourceItemId,
        relativePath: 'Social/x/selected.md',
        reviewRevision: 1,
        createdAt: timestamp(7),
      }),
    ).resolves.toMatchObject({ reviewRevision: 1 });
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
    await store.putJobItem('job-1', 1, item, checkpoint(1, timestamp(2)));
    await classifyItem(store, 'job-1', item.sourceItemId, 'new', timestamp(3));
    await prepareWritingJob(
      store,
      'job-1',
      [item.sourceItemId],
      timestamp(4),
      timestamp(4),
      timestamp(5),
    );
    await store.putWriteIntent({
      id: 'intent-1',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-7.md',
      reviewRevision: 1,
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
    await store.putJobItem('job-1', 1, item, checkpoint(1, timestamp(2)));
    await classifyItem(store, 'job-1', item.sourceItemId, 'new', timestamp(3));
    await prepareWritingJob(
      store,
      'job-1',
      [item.sourceItemId],
      timestamp(4),
      timestamp(4),
      timestamp(5),
    );

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
      reviewRevision: 1,
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
        reviewRevision: 1,
        createdAt: timestamp(9),
      }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'writing',
      summary: { writeErrorCount: 1, writePendingCount: 0 },
    });
    await expect(store.getJobItem('job-1', item.sourceItemId)).resolves.toMatchObject({
      writeStatus: 'error',
    });
    await store.transitionJob('job-1', 'partial', timestamp(9));
    await store.authorizeReviewSelection('job-1', 1, [item.sourceItemId], timestamp(10));

    await expect(
      store.putWriteIntent({
        id: 'intent-different-path',
        jobId: 'job-1',
        sourceItemId: item.sourceItemId,
        relativePath: 'Social/x/different-item-8.md',
        reviewRevision: 1,
        createdAt: timestamp(11),
      }),
    ).rejects.toBeInstanceOf(SyncStoreConflictError);
    await store.putWriteIntent({
      id: 'intent-retry',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-8.md',
      reviewRevision: 1,
      createdAt: timestamp(11),
    });
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      summary: { writeErrorCount: 0, writePendingCount: 1 },
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
      summary: { createdCount: 1, writeErrorCount: 0 },
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
    await persistScanBatch(store, 'job-1', [failedItem, pendingItem], checkpoint(2, timestamp(2)));
    await classifyItem(store, 'job-1', failedItem.sourceItemId, 'new', timestamp(3));
    await classifyItem(store, 'job-1', pendingItem.sourceItemId, 'new', timestamp(3));
    await prepareWritingJob(
      store,
      'job-1',
      [failedItem.sourceItemId, pendingItem.sourceItemId],
      timestamp(4),
      timestamp(4),
      timestamp(5),
    );
    await store.putWriteIntent({
      id: 'intent-failed-item',
      jobId: 'job-1',
      sourceItemId: failedItem.sourceItemId,
      relativePath: 'Social/x/failed-item.md',
      reviewRevision: 1,
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
      reviewRevision: 1,
      createdAt: timestamp(8),
    });

    await expect(store.transitionJob('job-1', 'partial', timestamp(9))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(store.getJob('job-1')).resolves.toMatchObject({
      status: 'writing',
      summary: { writeErrorCount: 1, writePendingCount: 1 },
    });
    store.close();
  });

  it('rejects partial while a selected item has not entered the write protocol', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'sync-partial-unattempted-selected-item',
    });
    await createScanningJob(store);
    const failedItem = socialItem(20, 'x');
    const untouchedItem = socialItem(21, 'x');
    await persistScanBatch(
      store,
      'job-1',
      [failedItem, untouchedItem],
      checkpoint(2, timestamp(2)),
    );
    await classifyItem(store, 'job-1', failedItem.sourceItemId, 'new', timestamp(3));
    await classifyItem(store, 'job-1', untouchedItem.sourceItemId, 'new', timestamp(3));
    await prepareWritingJob(
      store,
      'job-1',
      [failedItem.sourceItemId, untouchedItem.sourceItemId],
      timestamp(4),
      timestamp(4),
      timestamp(5),
    );
    await store.putWriteIntent({
      id: 'intent-only-failed-item',
      jobId: 'job-1',
      sourceItemId: failedItem.sourceItemId,
      relativePath: 'Social/x/failed-only.md',
      reviewRevision: 1,
      createdAt: timestamp(6),
    });
    await store.commitWriteIntent(
      'intent-only-failed-item',
      { status: 'error', relativePath: 'Social/x/failed-only.md', code: 'write_failed' },
      timestamp(7),
    );

    await expect(store.transitionJob('job-1', 'partial', timestamp(8))).rejects.toBeInstanceOf(
      SyncStoreConflictError,
    );
    await expect(store.getJobItem('job-1', untouchedItem.sourceItemId)).resolves.toMatchObject({
      reviewDecision: 'selected',
      writeStatus: 'not_requested',
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
    await store.putJobItem('job-1', 1, item, checkpoint(1, timestamp(2)));
    await classifyItem(store, 'job-1', item.sourceItemId, 'new', timestamp(3));
    await prepareWritingJob(
      store,
      'job-1',
      [item.sourceItemId],
      timestamp(4),
      timestamp(4),
      timestamp(5),
    );
    await store.putWriteIntent({
      id: 'intent-stale',
      jobId: 'job-1',
      sourceItemId: item.sourceItemId,
      relativePath: 'Social/x/item-9.md',
      reviewRevision: 1,
      createdAt: timestamp(6),
    });
    await store.pauseJobWithStopRecord('job-1', 1, 'user_paused', 'writing', timestamp(7));

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
