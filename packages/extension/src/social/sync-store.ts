import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import {
  ACTIVE_SYNC_JOB_STATUSES,
  ContentHashSchema,
  EMPTY_SYNC_JOB_SUMMARY,
  HttpsUrlSchema,
  IsoTimestampSchema,
  RelativeMarkdownPathSchema,
  SYNC_LIMITS,
  SYNC_SCHEMA_VERSION,
  SocialItemSchema,
  SocialSourceSchema,
  SourceItemIdSchema,
  SyncBudgetsSchema,
  SyncCheckpointSchema,
  SyncItemClassificationSchema,
  SyncJobIdSchema,
  SyncJobItemRowSchema,
  SyncJobItemSchema,
  SyncJobRowSchema,
  SyncJobSchema,
  SyncJobStatusSchema,
  SyncMetaSchema,
  SyncRecordSchema,
  WriteIntentIdSchema,
  WriteIntentSchema,
  WriteOutcomeSchema,
  makeSyncJobItemKey,
  makeSyncRecordKey,
  type SocialItem,
  type SocialSource,
  type SyncBudgets,
  type SyncCheckpoint,
  type SyncItemClassification,
  type SyncItemWriteStatus,
  type SyncJob,
  type SyncJobItem,
  type SyncJobItemRow,
  type SyncJobRow,
  type SyncJobStatus,
  type SyncMeta,
  type SyncRecord,
  type WriteIntent,
} from './sync-schema.js';

export const SYNC_DATABASE_NAME = 'shuhai-sync';
export const SYNC_DATABASE_VERSION = 1;

export const SYNC_STORE_NAMES = ['jobs', 'items', 'records', 'intents', 'meta'] as const;
export type SyncStoreName = (typeof SYNC_STORE_NAMES)[number];

const MAX_LIST_RESULTS = 10_000;
const MAX_TRANSACTION_INPUT_BYTES = 32 * 1_024 * 1_024;
const encoder = new TextEncoder();

interface SyncDatabase extends DBSchema {
  jobs: {
    key: string;
    value: unknown;
    indexes: {
      'by-source': SocialSource;
      'by-status': SyncJobStatus;
      'by-active-source': SocialSource;
    };
  };
  items: {
    key: string;
    value: unknown;
    indexes: {
      'by-job-id': string;
      'by-job-source-item': [string, string];
      'by-job-classification': [string, SyncItemClassification];
      'by-job-write-status': [string, SyncItemWriteStatus];
    };
  };
  records: {
    key: string;
    value: unknown;
    indexes: {
      'by-source': SocialSource;
      'by-canonical-url': string;
      'by-content-hash': string;
    };
  };
  intents: {
    key: string;
    value: unknown;
    indexes: {
      'by-job-id': string;
      'by-item-key': string;
      'by-record-key': string;
    };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

interface RuntimeSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
  parse(input: unknown): T;
}

interface IndexLayout {
  keyPath: string | readonly string[];
  unique?: boolean;
}

interface StoreLayout {
  keyPath: string;
  indexes: Readonly<Record<string, IndexLayout>>;
}

const EXPECTED_LAYOUT: Readonly<Record<SyncStoreName, StoreLayout>> = {
  jobs: {
    keyPath: 'id',
    indexes: {
      'by-source': { keyPath: 'source' },
      'by-status': { keyPath: 'status' },
      'by-active-source': { keyPath: 'activeSource', unique: true },
    },
  },
  items: {
    keyPath: 'key',
    indexes: {
      'by-job-id': { keyPath: 'jobId' },
      'by-job-source-item': { keyPath: ['jobId', 'sourceItemId'], unique: true },
      'by-job-classification': { keyPath: ['jobId', 'classification'] },
      'by-job-write-status': { keyPath: ['jobId', 'writeStatus'] },
    },
  },
  records: {
    keyPath: 'key',
    indexes: {
      'by-source': { keyPath: 'source' },
      'by-canonical-url': { keyPath: 'canonicalUrl' },
      'by-content-hash': { keyPath: 'contentHash' },
    },
  },
  intents: {
    keyPath: 'id',
    indexes: {
      'by-job-id': { keyPath: 'jobId' },
      'by-item-key': { keyPath: 'itemKey', unique: true },
      'by-record-key': { keyPath: 'recordKey' },
    },
  },
  meta: {
    keyPath: 'key',
    indexes: {},
  },
};

const ALLOWED_TRANSITIONS: Readonly<Record<SyncJobStatus, ReadonlySet<SyncJobStatus>>> = {
  prepared: new Set(['scanning']),
  scanning: new Set(['paused', 'ready_for_review', 'failed', 'cancelled']),
  ready_for_review: new Set(['writing']),
  writing: new Set(['partial', 'complete', 'paused', 'failed']),
  partial: new Set(['writing', 'cancelled']),
  paused: new Set(['scanning', 'writing', 'cancelled']),
  complete: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export type SyncStoreErrorCode =
  | 'open_failed'
  | 'open_blocked'
  | 'unsupported_database_version'
  | 'invalid_database_layout'
  | 'corrupt_row'
  | 'not_found'
  | 'active_job_exists'
  | 'invalid_job_transition'
  | 'conflict'
  | 'transaction_failed';

export class SyncStoreError extends Error {
  readonly code: SyncStoreErrorCode;

  constructor(code: SyncStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SyncStoreError';
    this.code = code;
  }
}

export class SyncStoreOpenError extends SyncStoreError {
  constructor(code: 'open_failed' | 'open_blocked', message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = 'SyncStoreOpenError';
  }
}

export class SyncStoreMigrationError extends SyncStoreError {
  constructor(
    code: 'unsupported_database_version' | 'invalid_database_layout',
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
    this.name = 'SyncStoreMigrationError';
  }
}

export class CorruptSyncRowError extends SyncStoreError {
  readonly storeName: SyncStoreName;
  readonly rowKey: IDBValidKey;

  constructor(storeName: SyncStoreName, rowKey: IDBValidKey, cause: unknown) {
    super('corrupt_row', `Stored ${storeName} row failed runtime validation`, { cause });
    this.name = 'CorruptSyncRowError';
    this.storeName = storeName;
    this.rowKey = rowKey;
  }
}

export class SyncStoreNotFoundError extends SyncStoreError {
  readonly entity: 'job' | 'item' | 'intent' | 'record';

  constructor(entity: 'job' | 'item' | 'intent' | 'record') {
    super('not_found', `Required sync ${entity} was not found`);
    this.name = 'SyncStoreNotFoundError';
    this.entity = entity;
  }
}

export class ActiveSyncJobExistsError extends SyncStoreError {
  readonly source: SocialSource;
  readonly activeJobId?: string;

  constructor(source: SocialSource, activeJobId?: string) {
    super('active_job_exists', `An active ${source} sync job already exists`);
    this.name = 'ActiveSyncJobExistsError';
    this.source = source;
    this.activeJobId = activeJobId;
  }
}

export class InvalidSyncJobTransitionError extends SyncStoreError {
  readonly from: SyncJobStatus;
  readonly to: SyncJobStatus;

  constructor(from: SyncJobStatus, to: SyncJobStatus) {
    super('invalid_job_transition', `Sync job cannot transition from ${from} to ${to}`);
    this.name = 'InvalidSyncJobTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class SyncStoreConflictError extends SyncStoreError {
  constructor(message: string) {
    super('conflict', message);
    this.name = 'SyncStoreConflictError';
  }
}

export interface SyncStoreVersionEvent {
  currentVersion: number;
  requestedVersion: number | null;
}

export interface OpenSyncStoreOptions {
  dbName?: string;
  indexedDB?: IDBFactory;
  now?: () => string;
  onBlocked?: (event: SyncStoreVersionEvent) => void;
  onBlocking?: (event: SyncStoreVersionEvent) => void;
  onTerminated?: () => void;
}

export interface CreateJobInput {
  id: string;
  source: SocialSource;
  adapterVersion: number;
  budgets: SyncBudgets;
  createdAt?: string;
}

export interface ListJobsOptions {
  source?: SocialSource;
  status?: SyncJobStatus;
  limit?: number;
}

export interface PutScanBatchResult {
  inserted: number;
  existing: number;
  job: SyncJob;
}

export interface PutJobItemResult {
  inserted: boolean;
  item: SyncJobItem;
  job: SyncJob;
}

export interface ListJobItemsOptions {
  limit?: number;
}

export interface ListRecordsOptions {
  source?: SocialSource;
  limit?: number;
}

export interface PutRecordsOptions {
  mode?: 'insert' | 'upsert';
}

export interface PutRecordsResult {
  inserted: number;
  updated: number;
}

export interface PutWriteIntentInput {
  id: string;
  jobId: string;
  sourceItemId: string;
  relativePath: string;
  createdAt?: string;
}

export interface ListWriteIntentsOptions {
  jobId?: string;
  limit?: number;
}

export interface CommitWriteIntentResult {
  job: SyncJob;
  item: SyncJobItem;
  record?: SyncRecord;
}

function namesOf(list: DOMStringList): string[] {
  return Array.from({ length: list.length }, (_, index) => list.item(index)!).sort();
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function normalizeKeyPath(keyPath: string | string[] | null): string | string[] | null {
  return Array.isArray(keyPath) ? [...keyPath] : keyPath;
}

function keyPathsEqual(
  actual: string | string[] | null,
  expected: string | readonly string[],
): boolean {
  if (typeof expected === 'string') {
    return actual === expected;
  }
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((part, index) => part === expected[index])
  );
}

function createV1Database(database: IDBDatabase): void {
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
  meta.put({
    key: 'schema',
    schemaVersion: SYNC_SCHEMA_VERSION,
    databaseVersion: SYNC_DATABASE_VERSION,
  } satisfies SyncMeta);
}

function assertDatabaseLayout(database: IDBDatabase): void {
  const actualStores = namesOf(database.objectStoreNames);
  const expectedStores = [...SYNC_STORE_NAMES].sort();
  if (JSON.stringify(actualStores) !== JSON.stringify(expectedStores)) {
    throw new SyncStoreMigrationError(
      'invalid_database_layout',
      'Sync database object stores do not match schema v1',
    );
  }

  const transaction = database.transaction(SYNC_STORE_NAMES, 'readonly');
  for (const storeName of SYNC_STORE_NAMES) {
    const expectedStore = EXPECTED_LAYOUT[storeName];
    const store = transaction.objectStore(storeName);
    if (!keyPathsEqual(normalizeKeyPath(store.keyPath), expectedStore.keyPath)) {
      throw new SyncStoreMigrationError(
        'invalid_database_layout',
        `Sync database ${storeName} keyPath does not match schema v1`,
      );
    }

    const actualIndexes = namesOf(store.indexNames);
    const expectedIndexes = Object.keys(expectedStore.indexes).sort();
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
      throw new SyncStoreMigrationError(
        'invalid_database_layout',
        `Sync database ${storeName} indexes do not match schema v1`,
      );
    }

    for (const [indexName, expectedIndex] of Object.entries(expectedStore.indexes)) {
      const index = store.index(indexName);
      if (
        !keyPathsEqual(normalizeKeyPath(index.keyPath), expectedIndex.keyPath) ||
        index.unique !== (expectedIndex.unique ?? false)
      ) {
        throw new SyncStoreMigrationError(
          'invalid_database_layout',
          `Sync database ${storeName}.${indexName} does not match schema v1`,
        );
      }
    }
  }
}

function openRawDatabase(
  factory: IDBFactory,
  dbName: string,
  onBlocked?: (event: SyncStoreVersionEvent) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, SYNC_DATABASE_VERSION);
    let settled = false;
    let upgradeError: unknown;

    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    request.addEventListener('upgradeneeded', (event) => {
      if (event.oldVersion !== 0 || event.newVersion !== SYNC_DATABASE_VERSION) {
        upgradeError = new SyncStoreMigrationError(
          'unsupported_database_version',
          'Only a fresh schema v1 sync database can be created',
        );
        request.transaction?.abort();
        return;
      }

      try {
        createV1Database(request.result);
      } catch (error) {
        upgradeError = error;
        request.transaction?.abort();
      }
    });

    request.addEventListener('blocked', (event) => {
      const info = { currentVersion: event.oldVersion, requestedVersion: event.newVersion };
      fail(
        new SyncStoreOpenError(
          'open_blocked',
          'Opening the sync database was blocked by another connection',
        ),
      );
      try {
        onBlocked?.(info);
      } catch {
        // The observer cannot change the fail-closed open result.
      }
    });

    request.addEventListener('error', () => {
      if (upgradeError) {
        fail(upgradeError);
        return;
      }
      if (request.error?.name === 'VersionError') {
        fail(
          new SyncStoreMigrationError(
            'unsupported_database_version',
            'The sync database is newer than schema v1',
            { cause: request.error },
          ),
        );
        return;
      }
      fail(
        new SyncStoreOpenError('open_failed', 'Failed to open the sync database', {
          cause: request.error,
        }),
      );
    });

    request.addEventListener('success', () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    });
  });
}

function parsePersistedRow<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
  storeName: SyncStoreName,
  rowKey: IDBValidKey,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CorruptSyncRowError(storeName, rowKey, result.error);
  }
  return result.data;
}

function publicJob(row: SyncJobRow): SyncJob {
  return SyncJobSchema.parse({
    schemaVersion: row.schemaVersion,
    id: row.id,
    source: row.source,
    status: row.status,
    adapterVersion: row.adapterVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.writeAuthorizedAt ? { writeAuthorizedAt: row.writeAuthorizedAt } : {}),
    ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}),
    budgets: row.budgets,
    summary: row.summary,
  });
}

function publicJobItem(row: SyncJobItemRow): SyncJobItem {
  return SyncJobItemSchema.parse({
    schemaVersion: row.schemaVersion,
    jobId: row.jobId,
    sourceItemId: row.sourceItemId,
    item: row.item,
    classification: row.classification,
    writeStatus: row.writeStatus,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    discoveredAt: row.discoveredAt,
    updatedAt: row.updatedAt,
  });
}

function rowWithStatus(row: SyncJobRow, status: SyncJobStatus, updatedAt: string): SyncJobRow {
  const candidate: Record<string, unknown> = {
    ...row,
    status,
    updatedAt,
  };
  if (ACTIVE_SYNC_JOB_STATUSES.has(status)) {
    candidate.activeSource = row.source;
  } else {
    delete candidate.activeSource;
  }
  if (status === 'writing' && (row.status === 'ready_for_review' || row.status === 'partial')) {
    candidate.writeAuthorizedAt = updatedAt;
  }
  return SyncJobRowSchema.parse(candidate);
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConstraintError'
  );
}

function listLimit(value: number | undefined): number {
  if (value === undefined) {
    return MAX_LIST_RESULTS;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_RESULTS) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIST_RESULTS}`);
  }
  return value;
}

function assertRecordKey(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('Record key must be a string');
  }
  const separator = value.indexOf(':');
  if (separator < 1) {
    throw new TypeError('Record key must be source:sourceItemId');
  }
  const source = SocialSourceSchema.parse(value.slice(0, separator));
  const sourceItemId = SourceItemIdSchema.parse(value.slice(separator + 1));
  const normalized = makeSyncRecordKey(source, sourceItemId);
  if (normalized !== value) {
    throw new TypeError('Record key must be source:sourceItemId');
  }
  return normalized;
}

function sameSocialItem(left: SocialItem, right: SocialItem): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRecordIdentity(left: SyncRecord, right: SyncRecord): boolean {
  return (
    left.key === right.key &&
    left.canonicalUrl === right.canonicalUrl &&
    left.contentHash === right.contentHash &&
    left.relativePath === right.relativePath &&
    left.completeness === right.completeness &&
    left.extractorVersion === right.extractorVersion
  );
}

function sameIntentIdentity(left: WriteIntent, right: WriteIntent): boolean {
  return (
    left.id === right.id &&
    left.jobId === right.jobId &&
    left.itemKey === right.itemKey &&
    left.recordKey === right.recordKey &&
    left.source === right.source &&
    left.sourceItemId === right.sourceItemId &&
    left.canonicalUrl === right.canonicalUrl &&
    left.relativePath === right.relativePath &&
    left.contentHash === right.contentHash &&
    left.completeness === right.completeness &&
    left.extractorVersion === right.extractorVersion
  );
}

function intentMatchesJobItem(intent: WriteIntent, item: SyncJobItemRow): boolean {
  return (
    intent.jobId === item.jobId &&
    intent.itemKey === item.key &&
    intent.sourceItemId === item.sourceItemId &&
    intent.recordKey === makeSyncRecordKey(item.item.source, item.sourceItemId) &&
    intent.source === item.item.source &&
    intent.canonicalUrl === item.item.canonicalUrl &&
    intent.contentHash === item.item.contentHash &&
    intent.completeness === item.item.completeness &&
    intent.extractorVersion === item.item.extractorVersion
  );
}

async function readTransaction<Names extends readonly StoreNames<SyncDatabase>[], Result>(
  database: IDBPDatabase<SyncDatabase>,
  storeNames: Names,
  operation: (transaction: IDBPTransaction<SyncDatabase, Names, 'readonly'>) => Promise<Result>,
): Promise<Result> {
  const transaction = database.transaction(storeNames, 'readonly');
  try {
    const result = await operation(transaction);
    await transaction.done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}

async function writeTransaction<Names extends readonly StoreNames<SyncDatabase>[], Result>(
  database: IDBPDatabase<SyncDatabase>,
  storeNames: Names,
  operation: (transaction: IDBPTransaction<SyncDatabase, Names, 'readwrite'>) => Promise<Result>,
): Promise<Result> {
  const transaction = database.transaction(storeNames, 'readwrite', { durability: 'strict' });
  try {
    const result = await operation(transaction);
    await transaction.done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}

export class SyncStore {
  readonly dbName: string;
  readonly databaseVersion = SYNC_DATABASE_VERSION;

  private readonly database: IDBPDatabase<SyncDatabase>;
  private readonly nowProvider: () => string;
  private closed = false;

  constructor(database: IDBPDatabase<SyncDatabase>, dbName: string, nowProvider: () => string) {
    this.database = database;
    this.dbName = dbName;
    this.nowProvider = nowProvider;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.database.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SyncStoreError('transaction_failed', 'Sync store is closed');
    }
  }

  private now(): string {
    return IsoTimestampSchema.parse(this.nowProvider());
  }

  async getMeta(): Promise<SyncMeta> {
    this.assertOpen();
    return readTransaction(this.database, ['meta'] as const, async (transaction) => {
      const value = await transaction.objectStore('meta').get('schema');
      if (value === undefined) {
        throw new SyncStoreMigrationError(
          'invalid_database_layout',
          'Sync database schema metadata is missing',
        );
      }
      return parsePersistedRow(SyncMetaSchema, value, 'meta', 'schema');
    });
  }

  async createJob(input: CreateJobInput): Promise<SyncJob> {
    this.assertOpen();
    const createdAt = IsoTimestampSchema.parse(input.createdAt ?? this.now());
    const source = SocialSourceSchema.parse(input.source);
    const id = SyncJobIdSchema.parse(input.id);
    const budgets = SyncBudgetsSchema.parse(input.budgets);
    const row = SyncJobRowSchema.parse({
      schemaVersion: SYNC_SCHEMA_VERSION,
      id,
      source,
      status: 'prepared',
      adapterVersion: input.adapterVersion,
      createdAt,
      updatedAt: createdAt,
      budgets,
      summary: { ...EMPTY_SYNC_JOB_SUMMARY },
      activeSource: source,
    });

    try {
      return await writeTransaction(this.database, ['jobs'] as const, async (transaction) => {
        const store = transaction.objectStore('jobs');
        const existingValue = await store.get(id);
        if (existingValue !== undefined) {
          const existing = parsePersistedRow(SyncJobRowSchema, existingValue, 'jobs', id);
          if (
            existing.source === source &&
            existing.adapterVersion === row.adapterVersion &&
            JSON.stringify(existing.budgets) === JSON.stringify(row.budgets)
          ) {
            return publicJob(existing);
          }
          throw new SyncStoreConflictError('A different sync job already uses this job ID');
        }

        const activeValue = await store.index('by-active-source').get(source);
        if (activeValue !== undefined) {
          const active = parsePersistedRow(SyncJobRowSchema, activeValue, 'jobs', source);
          throw new ActiveSyncJobExistsError(source, active.id);
        }

        await store.add(row);
        return publicJob(row);
      });
    } catch (error) {
      if (isConstraintError(error)) {
        const active = await this.getActiveJob(source);
        throw new ActiveSyncJobExistsError(source, active?.id);
      }
      throw error;
    }
  }

  async getJob(jobId: string): Promise<SyncJob | undefined> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    return readTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const value = await transaction.objectStore('jobs').get(id);
      return value === undefined
        ? undefined
        : publicJob(parsePersistedRow(SyncJobRowSchema, value, 'jobs', id));
    });
  }

  async getActiveJob(sourceInput: SocialSource): Promise<SyncJob | undefined> {
    this.assertOpen();
    const source = SocialSourceSchema.parse(sourceInput);
    return readTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const value = await transaction.objectStore('jobs').index('by-active-source').get(source);
      return value === undefined
        ? undefined
        : publicJob(parsePersistedRow(SyncJobRowSchema, value, 'jobs', source));
    });
  }

  async getCheckpoint(jobId: string): Promise<SyncCheckpoint | undefined> {
    return (await this.getJob(jobId))?.checkpoint;
  }

  async listJobs(options: ListJobsOptions = {}): Promise<SyncJob[]> {
    this.assertOpen();
    const source =
      options.source === undefined ? undefined : SocialSourceSchema.parse(options.source);
    const status =
      options.status === undefined ? undefined : SyncJobStatusSchema.parse(options.status);
    const limit = listLimit(options.limit);
    return readTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const store = transaction.objectStore('jobs');
      const values = source
        ? await store.index('by-source').getAll(source, MAX_LIST_RESULTS)
        : status
          ? await store.index('by-status').getAll(status, MAX_LIST_RESULTS)
          : await store.getAll(undefined, MAX_LIST_RESULTS);
      return values
        .map((value, index) => publicJob(parsePersistedRow(SyncJobRowSchema, value, 'jobs', index)))
        .filter((job) => (source ? job.source === source : true))
        .filter((job) => (status ? job.status === status : true))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, limit);
    });
  }

  async transitionJob(
    jobId: string,
    nextStatusInput: SyncJobStatus,
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const nextStatus = SyncJobStatusSchema.parse(nextStatusInput);
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const value = await jobs.get(id);
        if (value === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
        if (current.status === nextStatus) {
          return publicJob(current);
        }
        if (!ALLOWED_TRANSITIONS[current.status].has(nextStatus)) {
          throw new InvalidSyncJobTransitionError(current.status, nextStatus);
        }
        if (
          current.status === 'paused' &&
          ((nextStatus === 'writing' && !current.writeAuthorizedAt) ||
            (nextStatus === 'scanning' && current.writeAuthorizedAt))
        ) {
          throw new SyncStoreConflictError(
            'A paused job can only resume the phase from which it was paused',
          );
        }
        if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
          throw new SyncStoreConflictError('Job timestamps must be monotonic');
        }
        if (
          current.status === 'partial' &&
          nextStatus === 'writing' &&
          Date.parse(updatedAt) <= Date.parse(current.updatedAt)
        ) {
          throw new SyncStoreConflictError(
            'A retry authorization must be newer than the persisted partial state',
          );
        }

        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        if (nextStatus === 'ready_for_review') {
          const pendingReview = await items.index('by-job-classification').count([id, 'pending']);
          if (pendingReview !== 0) {
            throw new SyncStoreConflictError(
              'A job cannot enter review while items remain unclassified',
            );
          }
        }

        if (nextStatus === 'partial') {
          const unresolvedIntents = await intents.index('by-job-id').count(id);
          if (
            current.summary.errorCount === 0 ||
            current.summary.writePendingCount !== 0 ||
            unresolvedIntents !== 0
          ) {
            throw new SyncStoreConflictError(
              'A job can enter partial only after its write pass settles with errors',
            );
          }
        } else if (nextStatus === 'complete') {
          const counts = await Promise.all([
            items.index('by-job-classification').count([id, 'pending']),
            items.index('by-job-classification').count([id, 'error']),
            items.index('by-job-write-status').count([id, 'not_requested']),
            items.index('by-job-write-status').count([id, 'pending']),
            items.index('by-job-write-status').count([id, 'error']),
            intents.index('by-job-id').count(id),
          ]);
          if (counts.some((count) => count !== 0)) {
            throw new SyncStoreConflictError(
              'A job cannot complete with unwritten items, pending items, errors, or write intents',
            );
          }
        } else if (nextStatus === 'failed' || nextStatus === 'cancelled') {
          const unresolvedIntents = await intents.index('by-job-id').count(id);
          if (unresolvedIntents !== 0) {
            throw new SyncStoreConflictError(
              'A terminal job cannot retain unresolved write intents',
            );
          }
        }

        const next = rowWithStatus(current, nextStatus, updatedAt);
        await jobs.put(next);
        return publicJob(next);
      },
    );
  }

  async putScanBatch(
    jobId: string,
    itemInputs: readonly unknown[],
    checkpointInput: unknown,
  ): Promise<PutScanBatchResult> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    if (!Array.isArray(itemInputs)) {
      throw new TypeError('Scan batch must be an array');
    }
    if (itemInputs.length > SYNC_LIMITS.maxItemsPerJob) {
      throw new RangeError('Scan batch exceeds the item limit');
    }
    let batchBytes = 0;
    const items = itemInputs.map((item) => {
      const parsed = SocialItemSchema.parse(item);
      batchBytes += encoder.encode(JSON.stringify(parsed)).byteLength;
      if (batchBytes > MAX_TRANSACTION_INPUT_BYTES) {
        throw new RangeError('Scan batch exceeds the transaction byte limit');
      }
      return parsed;
    });
    const checkpoint = SyncCheckpointSchema.parse(checkpointInput);

    return writeTransaction(this.database, ['jobs', 'items'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const itemStore = transaction.objectStore('items');
      const jobValue = await jobs.get(id);
      if (jobValue === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
      if (job.status !== 'scanning') {
        throw new SyncStoreConflictError('Items can only be scanned into a scanning job');
      }
      if (checkpoint.adapterVersion !== job.adapterVersion) {
        throw new SyncStoreConflictError('Checkpoint adapterVersion does not match the job');
      }
      if (
        Date.parse(checkpoint.updatedAt) < Date.parse(job.updatedAt) ||
        checkpoint.scannedCount < job.summary.scannedCount ||
        checkpoint.acceptedCount < (job.checkpoint?.acceptedCount ?? 0)
      ) {
        throw new SyncStoreConflictError('Checkpoint progress must be monotonic');
      }

      let inserted = 0;
      let existing = 0;
      for (const item of items) {
        if (item.source !== job.source) {
          throw new SyncStoreConflictError('SocialItem source does not match the job source');
        }
        if (item.media.length > job.budgets.maxMediaPerItem) {
          throw new SyncStoreConflictError('SocialItem exceeds the job media budget');
        }
        if (encoder.encode(JSON.stringify(item)).byteLength > job.budgets.maxItemBytes) {
          throw new SyncStoreConflictError('SocialItem exceeds the job byte budget');
        }

        const key = makeSyncJobItemKey(id, item.sourceItemId);
        const currentValue = await itemStore.get(key);
        if (currentValue !== undefined) {
          const current = parsePersistedRow(SyncJobItemRowSchema, currentValue, 'items', key);
          if (!sameSocialItem(current.item, item)) {
            throw new SyncStoreConflictError(
              'A replayed source item conflicts with the persisted job item',
            );
          }
          existing += 1;
          continue;
        }

        const row = SyncJobItemRowSchema.parse({
          key,
          schemaVersion: SYNC_SCHEMA_VERSION,
          jobId: id,
          sourceItemId: item.sourceItemId,
          item,
          classification: 'pending',
          writeStatus: 'not_requested',
          discoveredAt: checkpoint.updatedAt,
          updatedAt: checkpoint.updatedAt,
        });
        await itemStore.add(row);
        inserted += 1;
      }

      const uniqueItemCount = job.summary.uniqueItemCount + inserted;
      if (
        uniqueItemCount > job.budgets.maxItems ||
        checkpoint.acceptedCount < uniqueItemCount ||
        checkpoint.scannedCount < uniqueItemCount
      ) {
        throw new SyncStoreConflictError('Checkpoint counts do not cover persisted unique items');
      }
      const nextJob = SyncJobRowSchema.parse({
        ...job,
        updatedAt: checkpoint.updatedAt,
        checkpoint,
        summary: {
          ...job.summary,
          scannedCount: checkpoint.scannedCount,
          uniqueItemCount,
          pendingReviewCount: job.summary.pendingReviewCount + inserted,
        },
      });
      await jobs.put(nextJob);
      return { inserted, existing, job: publicJob(nextJob) };
    });
  }

  async putJobItem(
    jobId: string,
    itemInput: unknown,
    checkpointInput: unknown,
  ): Promise<PutJobItemResult> {
    const item = SocialItemSchema.parse(itemInput);
    const result = await this.putScanBatch(jobId, [item], checkpointInput);
    const stored = await this.getJobItem(jobId, item.sourceItemId);
    if (!stored) {
      throw new SyncStoreError(
        'transaction_failed',
        'Committed job item could not be read back from IndexedDB',
      );
    }
    return { inserted: result.inserted === 1, item: stored, job: result.job };
  }

  async putCheckpoint(jobId: string, checkpointInput: unknown): Promise<SyncJob> {
    return (await this.putScanBatch(jobId, [], checkpointInput)).job;
  }

  async getJobItem(jobId: string, sourceItemIdInput: string): Promise<SyncJobItem | undefined> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const sourceItemId = SourceItemIdSchema.parse(sourceItemIdInput);
    const key = makeSyncJobItemKey(id, sourceItemId);
    return readTransaction(this.database, ['items'] as const, async (transaction) => {
      const value = await transaction.objectStore('items').get(key);
      return value === undefined
        ? undefined
        : publicJobItem(parsePersistedRow(SyncJobItemRowSchema, value, 'items', key));
    });
  }

  async listJobItems(jobId: string, options: ListJobItemsOptions = {}): Promise<SyncJobItem[]> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const limit = listLimit(options.limit);
    return readTransaction(this.database, ['items'] as const, async (transaction) => {
      const values = await transaction.objectStore('items').index('by-job-id').getAll(id, limit);
      return values.map((value, index) =>
        publicJobItem(parsePersistedRow(SyncJobItemRowSchema, value, 'items', index)),
      );
    });
  }

  async updateJobItemClassification(
    jobId: string,
    sourceItemIdInput: string,
    classificationInput: SyncItemClassification,
    updatedAtInput?: string,
  ): Promise<SyncJobItem> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const sourceItemId = SourceItemIdSchema.parse(sourceItemIdInput);
    const classification = SyncItemClassificationSchema.parse(classificationInput);
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    const key = makeSyncJobItemKey(id, sourceItemId);

    return writeTransaction(this.database, ['jobs', 'items'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const items = transaction.objectStore('items');
      const [jobValue, itemValue] = await Promise.all([jobs.get(id), items.get(key)]);
      if (jobValue === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      if (itemValue === undefined) {
        throw new SyncStoreNotFoundError('item');
      }
      const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
      const item = parsePersistedRow(SyncJobItemRowSchema, itemValue, 'items', key);
      if (job.status !== 'scanning' && job.status !== 'ready_for_review') {
        throw new SyncStoreConflictError('Items cannot be classified in the current job state');
      }
      if (item.classification === classification) {
        return publicJobItem(item);
      }
      if (item.classification !== 'pending' || classification === 'pending') {
        throw new SyncStoreConflictError('Item classification is immutable after first decision');
      }
      if (
        Date.parse(updatedAt) < Date.parse(item.updatedAt) ||
        Date.parse(updatedAt) < Date.parse(job.updatedAt)
      ) {
        throw new SyncStoreConflictError('Item timestamps must be monotonic');
      }

      const nextItem = SyncJobItemRowSchema.parse({
        ...item,
        classification,
        updatedAt,
      });
      const nextJob = SyncJobRowSchema.parse({
        ...job,
        updatedAt,
        summary: {
          ...job.summary,
          pendingReviewCount: job.summary.pendingReviewCount - 1,
          errorCount: job.summary.errorCount + (classification === 'error' ? 1 : 0),
        },
      });
      await Promise.all([items.put(nextItem), jobs.put(nextJob)]);
      return publicJobItem(nextItem);
    });
  }

  async getRecordByKey(recordKeyInput: string): Promise<SyncRecord | undefined> {
    this.assertOpen();
    const recordKey = assertRecordKey(recordKeyInput);
    return readTransaction(this.database, ['records'] as const, async (transaction) => {
      const value = await transaction.objectStore('records').get(recordKey);
      return value === undefined
        ? undefined
        : parsePersistedRow(SyncRecordSchema, value, 'records', recordKey);
    });
  }

  async getRecordByCanonicalUrl(urlInput: string): Promise<SyncRecord | undefined> {
    this.assertOpen();
    const canonicalUrl = HttpsUrlSchema.parse(urlInput);
    return readTransaction(this.database, ['records'] as const, async (transaction) => {
      const values = await transaction
        .objectStore('records')
        .index('by-canonical-url')
        .getAll(canonicalUrl, 2);
      const records = values.map((value, index) =>
        parsePersistedRow(SyncRecordSchema, value, 'records', index),
      );
      if (records.length > 1) {
        throw new SyncStoreConflictError('Canonical URL matches multiple catalog records');
      }
      return records[0];
    });
  }

  async getRecordByContentHash(hashInput: string): Promise<SyncRecord | undefined> {
    this.assertOpen();
    const contentHash = ContentHashSchema.parse(hashInput);
    return readTransaction(this.database, ['records'] as const, async (transaction) => {
      const values = await transaction
        .objectStore('records')
        .index('by-content-hash')
        .getAll(contentHash, 2);
      const records = values.map((value, index) =>
        parsePersistedRow(SyncRecordSchema, value, 'records', index),
      );
      if (records.length > 1) {
        throw new SyncStoreConflictError('Content hash matches multiple catalog records');
      }
      return records[0];
    });
  }

  async listRecords(options: ListRecordsOptions = {}): Promise<SyncRecord[]> {
    this.assertOpen();
    const source =
      options.source === undefined ? undefined : SocialSourceSchema.parse(options.source);
    const limit = listLimit(options.limit);
    return readTransaction(this.database, ['records'] as const, async (transaction) => {
      const store = transaction.objectStore('records');
      const values = source
        ? await store.index('by-source').getAll(source, limit)
        : await store.getAll(undefined, limit);
      return values.map((value, index) =>
        parsePersistedRow(SyncRecordSchema, value, 'records', index),
      );
    });
  }

  async putRecord(recordInput: unknown): Promise<SyncRecord> {
    const record = SyncRecordSchema.parse(recordInput);
    await this.putRecords([record]);
    return record;
  }

  async putRecords(
    recordInputs: readonly unknown[],
    options: PutRecordsOptions = {},
  ): Promise<PutRecordsResult> {
    this.assertOpen();
    if (!Array.isArray(recordInputs)) {
      throw new TypeError('Catalog batch must be an array');
    }
    if (recordInputs.length > SYNC_LIMITS.maxCatalogBatch) {
      throw new RangeError('Catalog batch exceeds the record limit');
    }
    let batchBytes = 0;
    const records = recordInputs.map((record) => {
      const parsed = SyncRecordSchema.parse(record);
      batchBytes += encoder.encode(JSON.stringify(parsed)).byteLength;
      if (batchBytes > MAX_TRANSACTION_INPUT_BYTES) {
        throw new RangeError('Catalog batch exceeds the transaction byte limit');
      }
      return parsed;
    });
    const keys = new Set<string>();
    for (const record of records) {
      if (keys.has(record.key)) {
        throw new SyncStoreConflictError('Catalog batch contains duplicate record keys');
      }
      keys.add(record.key);
    }
    const mode = options.mode ?? 'upsert';

    return writeTransaction(this.database, ['records'] as const, async (transaction) => {
      const store = transaction.objectStore('records');
      if (mode === 'insert') {
        await Promise.all(records.map((record) => store.add(record)));
        return { inserted: records.length, updated: 0 };
      }

      const existingValues = await Promise.all(records.map((record) => store.get(record.key)));
      let inserted = 0;
      let updated = 0;
      existingValues.forEach((value, index) => {
        if (value === undefined) {
          inserted += 1;
        } else {
          const existing = parsePersistedRow(
            SyncRecordSchema,
            value,
            'records',
            records[index]!.key,
          );
          if (
            !sameRecordIdentity(existing, records[index]!) ||
            existing.importedAt !== records[index]!.importedAt
          ) {
            throw new SyncStoreConflictError(
              'Catalog upsert cannot replace an existing record identity',
            );
          }
          if (Date.parse(records[index]!.lastSeenAt) < Date.parse(existing.lastSeenAt)) {
            throw new SyncStoreConflictError('Catalog lastSeenAt must be monotonic');
          }
          updated += 1;
        }
      });
      await Promise.all(records.map((record) => store.put(record)));
      return { inserted, updated };
    });
  }

  async putWriteIntent(input: PutWriteIntentInput): Promise<WriteIntent> {
    this.assertOpen();
    const intentId = WriteIntentIdSchema.parse(input.id);
    const jobId = SyncJobIdSchema.parse(input.jobId);
    const sourceItemId = SourceItemIdSchema.parse(input.sourceItemId);
    const relativePath = RelativeMarkdownPathSchema.parse(input.relativePath);
    const createdAt = IsoTimestampSchema.parse(input.createdAt ?? this.now());
    const itemKey = makeSyncJobItemKey(jobId, sourceItemId);

    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        const [jobValue, itemValue, existingIntentValue] = await Promise.all([
          jobs.get(jobId),
          items.get(itemKey),
          intents.get(intentId),
        ]);
        if (jobValue === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        if (itemValue === undefined) {
          throw new SyncStoreNotFoundError('item');
        }
        const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', jobId);
        const item = parsePersistedRow(SyncJobItemRowSchema, itemValue, 'items', itemKey);
        if (job.status !== 'writing') {
          throw new SyncStoreConflictError('Write intents require a writing job');
        }
        if (item.classification === 'pending' || item.classification === 'error') {
          throw new SyncStoreConflictError('Unreviewed or invalid items cannot be written');
        }
        if (Date.parse(createdAt) < Date.parse(job.updatedAt)) {
          throw new SyncStoreConflictError('Intent timestamps must be monotonic');
        }

        const intent = WriteIntentSchema.parse({
          schemaVersion: SYNC_SCHEMA_VERSION,
          id: intentId,
          jobId,
          itemKey,
          recordKey: makeSyncRecordKey(item.item.source, sourceItemId),
          source: item.item.source,
          sourceItemId,
          canonicalUrl: item.item.canonicalUrl,
          contentHash: item.item.contentHash,
          relativePath,
          completeness: item.item.completeness,
          extractorVersion: item.item.extractorVersion,
          createdAt,
        });

        if (existingIntentValue !== undefined) {
          const existing = parsePersistedRow(
            WriteIntentSchema,
            existingIntentValue,
            'intents',
            intentId,
          );
          if (
            sameIntentIdentity(existing, intent) &&
            intentMatchesJobItem(existing, item) &&
            item.writeStatus === 'pending' &&
            item.outcome === undefined &&
            job.summary.writePendingCount > 0
          ) {
            return existing;
          }
          throw new SyncStoreConflictError('Write intent state does not match the persisted item');
        }
        const itemIntentValue = await intents.index('by-item-key').get(itemKey);
        if (itemIntentValue !== undefined) {
          const itemIntent = parsePersistedRow(
            WriteIntentSchema,
            itemIntentValue,
            'intents',
            itemKey,
          );
          throw new SyncStoreConflictError(
            `Item already has an unresolved write intent (${itemIntent.id})`,
          );
        }
        const retryingError = item.writeStatus === 'error';
        if (item.writeStatus !== 'not_requested' && !retryingError) {
          throw new SyncStoreConflictError('Item has already entered the write protocol');
        }
        if (retryingError && item.outcome?.status !== 'error') {
          throw new CorruptSyncRowError(
            'items',
            itemKey,
            new Error('An error retry requires a matching persisted error outcome'),
          );
        }
        if (retryingError && item.outcome?.relativePath !== relativePath) {
          throw new SyncStoreConflictError(
            'An error retry must reuse the previously authorized Vault path',
          );
        }
        if (retryingError && job.summary.errorCount < 1) {
          throw new CorruptSyncRowError(
            'jobs',
            job.id,
            new Error('errorCount is inconsistent with the retried item'),
          );
        }
        if (
          retryingError &&
          (!job.writeAuthorizedAt ||
            Date.parse(job.writeAuthorizedAt) <= Date.parse(item.updatedAt))
        ) {
          throw new SyncStoreConflictError(
            'An error retry requires a newer partial-to-writing authorization',
          );
        }

        const nextItemInput: Record<string, unknown> = {
          ...item,
          writeStatus: 'pending',
          updatedAt: createdAt,
        };
        delete nextItemInput.outcome;
        const nextItem = SyncJobItemRowSchema.parse(nextItemInput);
        const nextJob = SyncJobRowSchema.parse({
          ...job,
          updatedAt: createdAt,
          summary: {
            ...job.summary,
            writePendingCount: job.summary.writePendingCount + 1,
            errorCount: job.summary.errorCount - (retryingError ? 1 : 0),
          },
        });
        await Promise.all([intents.add(intent), items.put(nextItem), jobs.put(nextJob)]);
        return intent;
      },
    );
  }

  async getWriteIntent(intentIdInput: string): Promise<WriteIntent | undefined> {
    this.assertOpen();
    const intentId = WriteIntentIdSchema.parse(intentIdInput);
    return readTransaction(this.database, ['intents'] as const, async (transaction) => {
      const value = await transaction.objectStore('intents').get(intentId);
      return value === undefined
        ? undefined
        : parsePersistedRow(WriteIntentSchema, value, 'intents', intentId);
    });
  }

  async listWriteIntents(options: ListWriteIntentsOptions = {}): Promise<WriteIntent[]> {
    this.assertOpen();
    const jobId = options.jobId === undefined ? undefined : SyncJobIdSchema.parse(options.jobId);
    const limit = listLimit(options.limit);
    return readTransaction(this.database, ['intents'] as const, async (transaction) => {
      const store = transaction.objectStore('intents');
      const values = jobId
        ? await store.index('by-job-id').getAll(jobId, limit)
        : await store.getAll(undefined, limit);
      return values.map((value, index) =>
        parsePersistedRow(WriteIntentSchema, value, 'intents', index),
      );
    });
  }

  async commitWriteIntent(
    intentIdInput: string,
    outcomeInput: unknown,
    committedAtInput?: string,
  ): Promise<CommitWriteIntentResult> {
    this.assertOpen();
    const intentId = WriteIntentIdSchema.parse(intentIdInput);
    const outcome = WriteOutcomeSchema.parse(outcomeInput);
    const committedAt = IsoTimestampSchema.parse(committedAtInput ?? this.now());

    return writeTransaction(
      this.database,
      ['jobs', 'items', 'records', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const records = transaction.objectStore('records');
        const intents = transaction.objectStore('intents');
        const intentValue = await intents.get(intentId);
        if (intentValue === undefined) {
          throw new SyncStoreNotFoundError('intent');
        }
        const intent = parsePersistedRow(WriteIntentSchema, intentValue, 'intents', intentId);
        const [jobValue, itemValue] = await Promise.all([
          jobs.get(intent.jobId),
          items.get(intent.itemKey),
        ]);
        if (jobValue === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        if (itemValue === undefined) {
          throw new SyncStoreNotFoundError('item');
        }
        const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', intent.jobId);
        const item = parsePersistedRow(SyncJobItemRowSchema, itemValue, 'items', intent.itemKey);
        if (job.status !== 'writing' && job.status !== 'partial' && job.status !== 'paused') {
          throw new SyncStoreConflictError('Write intent cannot be committed in this job state');
        }
        if (item.writeStatus !== 'pending' || item.outcome !== undefined) {
          throw new SyncStoreConflictError('Write intent item is not pending');
        }
        if (job.source !== intent.source || !intentMatchesJobItem(intent, item)) {
          throw new SyncStoreConflictError('Write intent identity does not match its job item');
        }
        if (outcome.relativePath !== intent.relativePath) {
          throw new SyncStoreConflictError('Write outcome path does not match the intent');
        }
        if (
          Date.parse(committedAt) < Date.parse(intent.createdAt) ||
          Date.parse(committedAt) < Date.parse(job.updatedAt) ||
          Date.parse(committedAt) < Date.parse(item.updatedAt)
        ) {
          throw new SyncStoreConflictError('Commit timestamps must be monotonic');
        }
        if (job.summary.writePendingCount < 1) {
          throw new CorruptSyncRowError(
            'jobs',
            job.id,
            new Error('writePendingCount is inconsistent with a pending intent'),
          );
        }

        let record: SyncRecord | undefined;
        if (outcome.status === 'created' || outcome.status === 'already_exists') {
          const candidate = SyncRecordSchema.parse({
            schemaVersion: SYNC_SCHEMA_VERSION,
            key: intent.recordKey,
            source: intent.source,
            sourceItemId: intent.sourceItemId,
            canonicalUrl: intent.canonicalUrl,
            contentHash: intent.contentHash,
            relativePath: intent.relativePath,
            completeness: intent.completeness,
            extractorVersion: intent.extractorVersion,
            importedAt: committedAt,
            lastSeenAt: committedAt,
          });
          const existingValue = await records.get(intent.recordKey);
          if (existingValue === undefined) {
            record = candidate;
          } else {
            const existing = parsePersistedRow(
              SyncRecordSchema,
              existingValue,
              'records',
              intent.recordKey,
            );
            if (!sameRecordIdentity(existing, candidate)) {
              throw new SyncStoreConflictError(
                'Existing catalog identity conflicts with the write intent',
              );
            }
            if (Date.parse(committedAt) < Date.parse(existing.lastSeenAt)) {
              throw new SyncStoreConflictError('Catalog timestamps must be monotonic');
            }
            record = SyncRecordSchema.parse({ ...existing, lastSeenAt: committedAt });
          }
        }

        const nextItem = SyncJobItemRowSchema.parse({
          ...item,
          writeStatus: outcome.status,
          outcome,
          updatedAt: committedAt,
        });
        const outcomeCountField = {
          created: 'createdCount',
          already_exists: 'alreadyExistsCount',
          skipped: 'skippedCount',
          error: undefined,
        }[outcome.status] as 'createdCount' | 'alreadyExistsCount' | 'skippedCount' | undefined;
        const nextSummary = {
          ...job.summary,
          writePendingCount: job.summary.writePendingCount - 1,
          errorCount: job.summary.errorCount + (outcome.status === 'error' ? 1 : 0),
        };
        if (outcomeCountField) {
          nextSummary[outcomeCountField] += 1;
        }
        const nextJob = SyncJobRowSchema.parse({
          ...job,
          updatedAt: committedAt,
          summary: nextSummary,
        });

        const requests: Promise<unknown>[] = [
          items.put(nextItem),
          jobs.put(nextJob),
          intents.delete(intentId),
        ];
        if (record) {
          requests.push(records.put(record));
        }
        await Promise.all(requests);
        return {
          job: publicJob(nextJob),
          item: publicJobItem(nextItem),
          ...(record ? { record } : {}),
        };
      },
    );
  }
}

export async function openSyncStore(options: OpenSyncStoreOptions = {}): Promise<SyncStore> {
  const dbName = options.dbName ?? SYNC_DATABASE_NAME;
  if (
    typeof dbName !== 'string' ||
    dbName.length < 1 ||
    dbName.length > 128 ||
    hasControlCharacters(dbName)
  ) {
    throw new TypeError('dbName must be a non-empty string without control characters');
  }
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new SyncStoreOpenError('open_failed', 'IndexedDB is unavailable in this context');
  }

  let rawDatabase: IDBDatabase | undefined;
  try {
    rawDatabase = await openRawDatabase(factory, dbName, options.onBlocked);
    assertDatabaseLayout(rawDatabase);
  } catch (error) {
    rawDatabase?.close();
    if (error instanceof SyncStoreError) {
      throw error;
    }
    throw new SyncStoreOpenError('open_failed', 'Failed to initialize the sync database', {
      cause: error,
    });
  }

  let database: IDBPDatabase<SyncDatabase>;
  try {
    database = wrap(rawDatabase) as IDBPDatabase<SyncDatabase>;
  } catch (error) {
    rawDatabase.close();
    throw new SyncStoreOpenError('open_failed', 'idb could not wrap the sync database', {
      cause: error,
    });
  }

  const store = new SyncStore(database, dbName, options.now ?? (() => new Date().toISOString()));
  rawDatabase.addEventListener('versionchange', (event) => {
    try {
      try {
        options.onBlocking?.({
          currentVersion: event.oldVersion,
          requestedVersion: event.newVersion,
        });
      } catch {
        // Observers cannot keep an obsolete database connection open.
      }
    } finally {
      store.close();
    }
  });
  rawDatabase.addEventListener('close', () => {
    store.close();
    try {
      options.onTerminated?.();
    } catch {
      // Observers cannot change the closed database state.
    }
  });
  try {
    const metaRows = await readTransaction(database, ['meta'] as const, async (transaction) =>
      transaction.objectStore('meta').getAll(),
    );
    if (metaRows.length !== 1) {
      throw new SyncStoreMigrationError(
        'invalid_database_layout',
        'Sync database schema metadata is incomplete or ambiguous',
      );
    }
    parsePersistedRow(SyncMetaSchema, metaRows[0], 'meta', 'schema');
  } catch (error) {
    store.close();
    if (error instanceof SyncStoreError) {
      throw error;
    }
    throw new SyncStoreMigrationError(
      'invalid_database_layout',
      'Sync database schema metadata is invalid',
      { cause: error },
    );
  }
  return store;
}
