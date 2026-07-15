import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import {
  ACTIVE_SYNC_JOB_STATUSES,
  ContentHashSchema,
  EMPTY_SYNC_JOB_SUMMARY,
  HttpsUrlSchema,
  IsoTimestampSchema,
  RelativeMarkdownPathSchema,
  SYNC_KNOWN_FRONTIER_LIMIT,
  SYNC_LIMITS,
  SYNC_JOB_CONTRACT_VERSION,
  SYNC_SCHEMA_VERSION,
  SocialItemSchema,
  SocialSourceSchema,
  SourceItemIdSchema,
  SyncBudgetsSchema,
  SyncCheckpointSchema,
  SyncItemClassificationSchema,
  SyncItemWriteStatusSchema,
  SyncJobIdSchema,
  SyncJobItemRowSchema,
  SyncJobItemSchema,
  SyncJobRowSchema,
  SyncJobSchema,
  SyncJobSummarySchema,
  SyncJobStatusSchema,
  SyncMetaSchema,
  SyncRecordSchema,
  SyncScanCompletionSchema,
  SyncScanModeSchema,
  SyncStopReasonSchema,
  SyncStopRecordSchema,
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
  type SyncJobSummary,
  type SyncJobStatus,
  type SyncMeta,
  type SyncRecord,
  type SyncReviewDecision,
  type SyncScanCompletion,
  type SyncScanMode,
  type SyncStopReason,
  type WriteIntent,
} from './sync-schema.js';

export const SYNC_DATABASE_NAME = 'shuhai-sync';
export const SYNC_DATABASE_VERSION = 3;

export const SYNC_STORE_NAMES = ['jobs', 'items', 'records', 'intents', 'meta'] as const;
export type SyncStoreName = (typeof SYNC_STORE_NAMES)[number];

const MAX_LIST_RESULTS = 10_000;
const MAX_TRANSACTION_INPUT_BYTES = 32 * 1_024 * 1_024;
const MAX_OBSERVED_NODES_PER_INVOCATION = 200;
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
  scanning: new Set(['paused', 'ready_for_review', 'failed']),
  ready_for_review: new Set(['writing']),
  writing: new Set(['partial', 'complete', 'paused', 'failed']),
  partial: new Set(['writing']),
  paused: new Set(['scanning', 'writing']),
  complete: new Set(),
  complete_with_issues: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export type SyncStoreErrorCode =
  | 'open_failed'
  | 'open_blocked'
  | 'unsupported_database_version'
  | 'invalid_database_layout'
  | 'DB3_REOPEN_VALIDATION_FAILED'
  | 'unsafe_migration_state'
  | 'migration_budget_exceeded'
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
    code:
      | 'unsupported_database_version'
      | 'invalid_database_layout'
      | 'DB3_REOPEN_VALIDATION_FAILED'
      | 'unsafe_migration_state'
      | 'migration_budget_exceeded',
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
  scanMode?: SyncScanMode;
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

export interface ClassifyAndPersistScanBatchResult {
  insertedCandidates: number;
  replayedCandidates: number;
  catalogExistingObservations: number;
  classifications: Array<{
    sourceItemId: string;
    classification: Exclude<SyncItemClassification, 'pending'>;
  }>;
  job: SyncJob;
}

export interface ScanTransactionGuard {
  readonly signal?: AbortSignal;
  readonly beforeCommit?: () => boolean;
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
  reviewRevision: number;
  createdAt?: string;
}

export interface SaveReviewSelectionResult {
  job: SyncJob;
  selectedSourceItemIds: string[];
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

function createV3Database(database: IDBDatabase): void {
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
    validationState: 'complete',
  } satisfies SyncMeta);
}

function assertDatabaseLayout(database: IDBDatabase, upgradeTransaction?: IDBTransaction): void {
  const actualStores = namesOf(database.objectStoreNames);
  const expectedStores = [...SYNC_STORE_NAMES].sort();
  if (JSON.stringify(actualStores) !== JSON.stringify(expectedStores)) {
    throw new SyncStoreMigrationError(
      'invalid_database_layout',
      'Sync database object stores do not match schema v3',
    );
  }

  const transaction = upgradeTransaction ?? database.transaction(SYNC_STORE_NAMES, 'readonly');
  for (const storeName of SYNC_STORE_NAMES) {
    const expectedStore = EXPECTED_LAYOUT[storeName];
    const store = transaction.objectStore(storeName);
    if (!keyPathsEqual(normalizeKeyPath(store.keyPath), expectedStore.keyPath)) {
      throw new SyncStoreMigrationError(
        'invalid_database_layout',
        `Sync database ${storeName} keyPath does not match schema v3`,
      );
    }

    const actualIndexes = namesOf(store.indexNames);
    const expectedIndexes = Object.keys(expectedStore.indexes).sort();
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
      throw new SyncStoreMigrationError(
        'invalid_database_layout',
        `Sync database ${storeName} indexes do not match schema v3`,
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
          `Sync database ${storeName}.${indexName} does not match schema v3`,
        );
      }
    }
  }
}

const MAX_MIGRATION_ROWS = 30_000;
const MAX_MIGRATION_BYTES = 16 * 1_024 * 1_024;
const MAX_MIGRATION_ROW_NODES = 4_096;
const MAX_MIGRATION_NODES = 500_000;
const FORBIDDEN_MIGRATION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface LegacyV1Checkpoint {
  schemaVersion: 1;
  adapterVersion: number;
  scannedCount: number;
  acceptedCount: number;
  consecutiveKnownIds: number;
  cursor?: string;
  updatedAt: string;
}

interface LegacyV1Summary {
  scannedCount: number;
  uniqueItemCount: number;
  pendingReviewCount: number;
  writePendingCount: number;
  createdCount: number;
  alreadyExistsCount: number;
  skippedCount: number;
  errorCount: number;
}

interface LegacyV1JobRow {
  schemaVersion: 1;
  id: string;
  source: SocialSource;
  status: SyncJobStatus;
  adapterVersion: number;
  createdAt: string;
  updatedAt: string;
  writeAuthorizedAt?: string;
  checkpoint?: LegacyV1Checkpoint;
  budgets: SyncBudgets;
  summary: LegacyV1Summary;
  activeSource?: SocialSource;
}

interface LegacyV1JobItemRow {
  key: string;
  schemaVersion: 1;
  jobId: string;
  sourceItemId: string;
  item: SocialItem;
  classification: SyncItemClassification;
  writeStatus: SyncItemWriteStatus;
  outcome?: ReturnType<typeof WriteOutcomeSchema.parse>;
  discoveredAt: string;
  updatedAt: string;
}

type LegacyJobStatus = Exclude<SyncJobStatus, 'complete_with_issues'>;

interface LegacyV2Checkpoint {
  schemaVersion: 1;
  adapterVersion: number;
  scanRevision: number;
  scannedCount: number;
  acceptedCount: number;
  acceptedBytes: number;
  consecutiveKnownIds: number;
  cursor?: string;
  updatedAt: string;
}

interface LegacyV2JobRow {
  schemaVersion: 1;
  id: string;
  source: SocialSource;
  status: LegacyJobStatus;
  adapterVersion: number;
  scanRevision: number;
  reviewRevision: number;
  authorizedReviewRevision?: number;
  createdAt: string;
  updatedAt: string;
  writeAuthorizedAt?: string;
  stopRecord?: ReturnType<typeof SyncStopRecordSchema.parse>;
  checkpoint?: LegacyV2Checkpoint;
  budgets: SyncBudgets;
  summary: SyncJobSummary;
  activeSource?: SocialSource;
}

function migrationFailure(
  code: 'unsafe_migration_state' | 'migration_budget_exceeded' | 'invalid_database_layout',
  message: string,
  cause?: unknown,
): SyncStoreMigrationError {
  return new SyncStoreMigrationError(code, message, cause === undefined ? undefined : { cause });
}

function normalizeMigrationError(error: unknown): SyncStoreMigrationError {
  return error instanceof SyncStoreMigrationError
    ? error
    : migrationFailure(
        'unsafe_migration_state',
        'Legacy data failed strict migration validation',
        error,
      );
}

function inspectMigrationValue(value: unknown): { bytes: number; nodes: number } {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let bytes = 0;
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_MIGRATION_ROW_NODES || current.depth > SYNC_LIMITS.structuredDepth) {
      throw migrationFailure('migration_budget_exceeded', 'A v1 row exceeds migration limits');
    }
    const currentValue = current.value;
    if (currentValue === null) {
      bytes += 4;
      continue;
    }
    if (typeof currentValue === 'string') {
      bytes += encoder.encode(currentValue).byteLength;
      continue;
    }
    if (typeof currentValue === 'number') {
      if (!Number.isFinite(currentValue)) {
        throw migrationFailure('unsafe_migration_state', 'A v1 row contains a non-finite number');
      }
      bytes += 8;
      continue;
    }
    if (typeof currentValue === 'boolean') {
      bytes += 1;
      continue;
    }
    if (typeof currentValue !== 'object') {
      throw migrationFailure('unsafe_migration_state', 'A v1 row contains an unsupported value');
    }
    if (seen.has(currentValue)) {
      throw migrationFailure('unsafe_migration_state', 'A v1 row contains a cycle');
    }
    seen.add(currentValue);

    if (Array.isArray(currentValue)) {
      if (Object.getPrototypeOf(currentValue) !== Array.prototype) {
        throw migrationFailure('unsafe_migration_state', 'A v1 row has a custom array prototype');
      }
      const descriptors = Object.getOwnPropertyDescriptors(currentValue);
      const keys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (keys.length !== currentValue.length) {
        throw migrationFailure('unsafe_migration_state', 'A v1 row contains a sparse array');
      }
      for (let index = 0; index < currentValue.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw migrationFailure('unsafe_migration_state', 'A v1 row contains an accessor');
        }
        stack.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(currentValue);
    if (prototype !== Object.prototype && prototype !== null) {
      throw migrationFailure('unsafe_migration_state', 'A v1 row has a custom object prototype');
    }
    const descriptors = Object.getOwnPropertyDescriptors(currentValue);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || FORBIDDEN_MIGRATION_KEYS.has(key)) {
        throw migrationFailure('unsafe_migration_state', 'A v1 row contains a forbidden key');
      }
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw migrationFailure('unsafe_migration_state', 'A v1 row contains an accessor');
      }
      bytes += encoder.encode(key).byteLength;
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }

  return { bytes, nodes };
}

function migrationRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw migrationFailure('unsafe_migration_state', `${label} is not a plain record`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw migrationFailure('unsafe_migration_state', `${label} has missing or unknown fields`);
  }
  return record;
}

function migrationCount(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw migrationFailure('unsafe_migration_state', `${label} is not a valid count`);
  }
  return value as number;
}

function migrationBoundedCount(value: unknown, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw migrationFailure('unsafe_migration_state', `${label} is not a valid bounded count`);
  }
  return value as number;
}

function migrationPositiveVersion(value: unknown, label: string): number {
  const parsed = migrationCount(value, label);
  if (parsed < 1) {
    throw migrationFailure('unsafe_migration_state', `${label} must be positive`);
  }
  return parsed;
}

function parseLegacyJobStatus(value: unknown, label: string): LegacyJobStatus {
  const status = SyncJobStatusSchema.parse(value);
  if (status === 'complete_with_issues') {
    throw migrationFailure('unsafe_migration_state', `${label} uses a v3-only status`);
  }
  return status;
}

function migrationCursor(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    encoder.encode(value).byteLength > SYNC_LIMITS.cursorBytes ||
    value !== value.trim() ||
    hasControlCharacters(value)
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 checkpoint cursor is invalid');
  }
  return value;
}

function parseLegacyV1Summary(value: unknown): LegacyV1Summary {
  const record = migrationRecord(
    value,
    [
      'scannedCount',
      'uniqueItemCount',
      'pendingReviewCount',
      'writePendingCount',
      'createdCount',
      'alreadyExistsCount',
      'skippedCount',
      'errorCount',
    ],
    [],
    'v1 job summary',
  );
  const summary: LegacyV1Summary = {
    scannedCount: migrationCount(record.scannedCount, 'v1 summary scannedCount'),
    uniqueItemCount: migrationCount(record.uniqueItemCount, 'v1 summary uniqueItemCount'),
    pendingReviewCount: migrationCount(record.pendingReviewCount, 'v1 summary pendingReviewCount'),
    writePendingCount: migrationCount(record.writePendingCount, 'v1 summary writePendingCount'),
    createdCount: migrationCount(record.createdCount, 'v1 summary createdCount'),
    alreadyExistsCount: migrationCount(record.alreadyExistsCount, 'v1 summary alreadyExistsCount'),
    skippedCount: migrationCount(record.skippedCount, 'v1 summary skippedCount'),
    errorCount: migrationCount(record.errorCount, 'v1 summary errorCount'),
  };
  const accounted =
    summary.pendingReviewCount +
    summary.writePendingCount +
    summary.createdCount +
    summary.alreadyExistsCount +
    summary.skippedCount +
    summary.errorCount;
  if (
    summary.uniqueItemCount > summary.scannedCount ||
    summary.pendingReviewCount > summary.uniqueItemCount ||
    accounted > summary.uniqueItemCount
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 job summary counts are inconsistent');
  }
  return summary;
}

function parseLegacyV1Checkpoint(value: unknown): LegacyV1Checkpoint {
  const record = migrationRecord(
    value,
    [
      'schemaVersion',
      'adapterVersion',
      'scannedCount',
      'acceptedCount',
      'consecutiveKnownIds',
      'updatedAt',
    ],
    ['cursor'],
    'v1 checkpoint',
  );
  if (record.schemaVersion !== 1) {
    throw migrationFailure('unsafe_migration_state', 'v1 checkpoint schemaVersion is invalid');
  }
  const checkpoint: LegacyV1Checkpoint = {
    schemaVersion: 1,
    adapterVersion: migrationPositiveVersion(record.adapterVersion, 'v1 checkpoint adapterVersion'),
    scannedCount: migrationCount(record.scannedCount, 'v1 checkpoint scannedCount'),
    acceptedCount: migrationCount(record.acceptedCount, 'v1 checkpoint acceptedCount'),
    consecutiveKnownIds: migrationCount(
      record.consecutiveKnownIds,
      'v1 checkpoint consecutiveKnownIds',
    ),
    ...(record.cursor === undefined ? {} : { cursor: migrationCursor(record.cursor) }),
    updatedAt: IsoTimestampSchema.parse(record.updatedAt),
  };
  if (
    checkpoint.acceptedCount > checkpoint.scannedCount ||
    checkpoint.consecutiveKnownIds > checkpoint.scannedCount
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 checkpoint counts are inconsistent');
  }
  return checkpoint;
}

function parseLegacyV1JobRow(value: unknown): LegacyV1JobRow {
  const record = migrationRecord(
    value,
    [
      'schemaVersion',
      'id',
      'source',
      'status',
      'adapterVersion',
      'createdAt',
      'updatedAt',
      'budgets',
      'summary',
    ],
    ['writeAuthorizedAt', 'checkpoint', 'activeSource'],
    'v1 job row',
  );
  if (record.schemaVersion !== 1) {
    throw migrationFailure('unsafe_migration_state', 'v1 job schemaVersion is invalid');
  }
  const createdAt = IsoTimestampSchema.parse(record.createdAt);
  const updatedAt = IsoTimestampSchema.parse(record.updatedAt);
  const status = parseLegacyJobStatus(record.status, 'v1 job');
  const source = SocialSourceSchema.parse(record.source);
  const writeAuthorizedAt =
    record.writeAuthorizedAt === undefined
      ? undefined
      : IsoTimestampSchema.parse(record.writeAuthorizedAt);
  const checkpoint =
    record.checkpoint === undefined ? undefined : parseLegacyV1Checkpoint(record.checkpoint);
  const activeSource =
    record.activeSource === undefined ? undefined : SocialSourceSchema.parse(record.activeSource);
  const job: LegacyV1JobRow = {
    schemaVersion: 1,
    id: SyncJobIdSchema.parse(record.id),
    source,
    status,
    adapterVersion: migrationPositiveVersion(record.adapterVersion, 'v1 job adapterVersion'),
    createdAt,
    updatedAt,
    ...(writeAuthorizedAt === undefined ? {} : { writeAuthorizedAt }),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    budgets: SyncBudgetsSchema.parse(record.budgets),
    summary: parseLegacyV1Summary(record.summary),
    ...(activeSource === undefined ? {} : { activeSource }),
  };

  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw migrationFailure('unsafe_migration_state', 'v1 job timestamps are not monotonic');
  }
  if (
    writeAuthorizedAt &&
    (Date.parse(writeAuthorizedAt) < Date.parse(createdAt) ||
      Date.parse(writeAuthorizedAt) > Date.parse(updatedAt))
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 authorization timestamp is invalid');
  }
  const isActive = ACTIVE_SYNC_JOB_STATUSES.has(status);
  if ((isActive && activeSource !== source) || (!isActive && activeSource !== undefined)) {
    throw migrationFailure('unsafe_migration_state', 'v1 active source index is inconsistent');
  }
  if (['writing', 'partial', 'complete'].includes(status) && !writeAuthorizedAt) {
    throw migrationFailure('unsafe_migration_state', 'v1 write state lacks authorization');
  }
  if (['prepared', 'scanning', 'ready_for_review'].includes(status) && writeAuthorizedAt) {
    throw migrationFailure('unsafe_migration_state', 'v1 pre-write state has authorization');
  }
  if (checkpoint) {
    if (
      checkpoint.adapterVersion !== job.adapterVersion ||
      checkpoint.scannedCount !== job.summary.scannedCount ||
      job.summary.uniqueItemCount > checkpoint.acceptedCount ||
      Date.parse(checkpoint.updatedAt) > Date.parse(updatedAt)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v1 checkpoint does not match its job');
    }
  } else if (job.summary.scannedCount !== 0 || job.summary.uniqueItemCount !== 0) {
    throw migrationFailure('unsafe_migration_state', 'v1 scan results lack a checkpoint');
  }
  return job;
}

function parseLegacyV1JobItemRow(value: unknown): LegacyV1JobItemRow {
  const record = migrationRecord(
    value,
    [
      'key',
      'schemaVersion',
      'jobId',
      'sourceItemId',
      'item',
      'classification',
      'writeStatus',
      'discoveredAt',
      'updatedAt',
    ],
    ['outcome'],
    'v1 job item row',
  );
  if (record.schemaVersion !== 1) {
    throw migrationFailure('unsafe_migration_state', 'v1 item schemaVersion is invalid');
  }
  const jobId = SyncJobIdSchema.parse(record.jobId);
  const sourceItemId = SourceItemIdSchema.parse(record.sourceItemId);
  const item = SocialItemSchema.parse(record.item);
  const classification = SyncItemClassificationSchema.parse(record.classification);
  const writeStatus = SyncItemWriteStatusSchema.parse(record.writeStatus);
  const outcome =
    record.outcome === undefined ? undefined : WriteOutcomeSchema.parse(record.outcome);
  const discoveredAt = IsoTimestampSchema.parse(record.discoveredAt);
  const updatedAt = IsoTimestampSchema.parse(record.updatedAt);
  if (typeof record.key !== 'string') {
    throw migrationFailure('unsafe_migration_state', 'v1 item key is not a string');
  }
  const row: LegacyV1JobItemRow = {
    key: record.key,
    schemaVersion: 1,
    jobId,
    sourceItemId,
    item,
    classification,
    writeStatus,
    ...(outcome === undefined ? {} : { outcome }),
    discoveredAt,
    updatedAt,
  };
  if (
    row.key !== makeSyncJobItemKey(jobId, sourceItemId) ||
    item.sourceItemId !== sourceItemId ||
    Date.parse(updatedAt) < Date.parse(discoveredAt)
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 item identity is inconsistent');
  }
  const terminal = ['created', 'already_exists', 'skipped', 'error'].includes(writeStatus);
  if ((terminal && outcome?.status !== writeStatus) || (!terminal && outcome !== undefined)) {
    throw migrationFailure('unsafe_migration_state', 'v1 item outcome is inconsistent');
  }
  if (
    (classification === 'pending' || classification === 'error') &&
    writeStatus !== 'not_requested'
  ) {
    throw migrationFailure('unsafe_migration_state', 'v1 invalid item entered write protocol');
  }
  return row;
}

function parseLegacyV2Checkpoint(value: unknown): LegacyV2Checkpoint {
  const record = migrationRecord(
    value,
    [
      'schemaVersion',
      'adapterVersion',
      'scanRevision',
      'scannedCount',
      'acceptedCount',
      'acceptedBytes',
      'consecutiveKnownIds',
      'updatedAt',
    ],
    ['cursor'],
    'v2 checkpoint',
  );
  if (record.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw migrationFailure('unsafe_migration_state', 'v2 checkpoint schemaVersion is invalid');
  }
  const checkpoint: LegacyV2Checkpoint = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    adapterVersion: migrationPositiveVersion(record.adapterVersion, 'v2 checkpoint adapterVersion'),
    scanRevision: migrationCount(record.scanRevision, 'v2 checkpoint scanRevision'),
    scannedCount: migrationCount(record.scannedCount, 'v2 checkpoint scannedCount'),
    acceptedCount: migrationCount(record.acceptedCount, 'v2 checkpoint acceptedCount'),
    acceptedBytes: migrationBoundedCount(
      record.acceptedBytes,
      SYNC_LIMITS.maxAcceptedBytesPerJob,
      'v2 checkpoint acceptedBytes',
    ),
    consecutiveKnownIds: migrationCount(
      record.consecutiveKnownIds,
      'v2 checkpoint consecutiveKnownIds',
    ),
    ...(record.cursor === undefined ? {} : { cursor: migrationCursor(record.cursor) }),
    updatedAt: IsoTimestampSchema.parse(record.updatedAt),
  };
  if (
    checkpoint.acceptedCount > checkpoint.scannedCount ||
    checkpoint.consecutiveKnownIds > checkpoint.scannedCount ||
    checkpoint.acceptedBytes > SYNC_LIMITS.maxAcceptedBytesPerJob
  ) {
    throw migrationFailure('unsafe_migration_state', 'v2 checkpoint counts are inconsistent');
  }
  return checkpoint;
}

function parseOperationCheckpoint(value: unknown): LegacyV2Checkpoint | SyncCheckpoint {
  const current = SyncCheckpointSchema.safeParse(value);
  if (current.success) {
    return current.data;
  }
  inspectMigrationValue(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'contractVersion')
  ) {
    return SyncCheckpointSchema.parse(value);
  }
  return parseLegacyV2Checkpoint(value);
}

function parseLegacyV2JobRow(value: unknown): LegacyV2JobRow {
  const record = migrationRecord(
    value,
    [
      'schemaVersion',
      'id',
      'source',
      'status',
      'adapterVersion',
      'scanRevision',
      'reviewRevision',
      'createdAt',
      'updatedAt',
      'budgets',
      'summary',
    ],
    ['authorizedReviewRevision', 'writeAuthorizedAt', 'stopRecord', 'checkpoint', 'activeSource'],
    'v2 job row',
  );
  if (record.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw migrationFailure('unsafe_migration_state', 'v2 job schemaVersion is invalid');
  }
  const status = parseLegacyJobStatus(record.status, 'v2 job');
  const source = SocialSourceSchema.parse(record.source);
  const createdAt = IsoTimestampSchema.parse(record.createdAt);
  const updatedAt = IsoTimestampSchema.parse(record.updatedAt);
  const writeAuthorizedAt =
    record.writeAuthorizedAt === undefined
      ? undefined
      : IsoTimestampSchema.parse(record.writeAuthorizedAt);
  const authorizedReviewRevision =
    record.authorizedReviewRevision === undefined
      ? undefined
      : migrationPositiveVersion(record.authorizedReviewRevision, 'v2 authorizedReviewRevision');
  const stopRecord =
    record.stopRecord === undefined ? undefined : SyncStopRecordSchema.parse(record.stopRecord);
  const checkpoint =
    record.checkpoint === undefined ? undefined : parseLegacyV2Checkpoint(record.checkpoint);
  const activeSource =
    record.activeSource === undefined ? undefined : SocialSourceSchema.parse(record.activeSource);
  const job: LegacyV2JobRow = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    id: SyncJobIdSchema.parse(record.id),
    source,
    status,
    adapterVersion: migrationPositiveVersion(record.adapterVersion, 'v2 job adapterVersion'),
    scanRevision: migrationCount(record.scanRevision, 'v2 job scanRevision'),
    reviewRevision: migrationCount(record.reviewRevision, 'v2 job reviewRevision'),
    ...(authorizedReviewRevision === undefined ? {} : { authorizedReviewRevision }),
    createdAt,
    updatedAt,
    ...(writeAuthorizedAt === undefined ? {} : { writeAuthorizedAt }),
    ...(stopRecord === undefined ? {} : { stopRecord }),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    budgets: SyncBudgetsSchema.parse(record.budgets),
    summary: SyncJobSummarySchema.parse(record.summary),
    ...(activeSource === undefined ? {} : { activeSource }),
  };

  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw migrationFailure('unsafe_migration_state', 'v2 job timestamps are not monotonic');
  }
  if (
    writeAuthorizedAt &&
    (Date.parse(writeAuthorizedAt) < Date.parse(createdAt) ||
      Date.parse(writeAuthorizedAt) > Date.parse(updatedAt))
  ) {
    throw migrationFailure('unsafe_migration_state', 'v2 authorization timestamp is invalid');
  }
  if ((writeAuthorizedAt === undefined) !== (authorizedReviewRevision === undefined)) {
    throw migrationFailure('unsafe_migration_state', 'v2 authorization fields are inconsistent');
  }
  if (authorizedReviewRevision !== undefined && authorizedReviewRevision !== job.reviewRevision) {
    throw migrationFailure('unsafe_migration_state', 'v2 authorization revision is stale');
  }
  const isActive = ACTIVE_SYNC_JOB_STATUSES.has(status);
  if ((isActive && activeSource !== source) || (!isActive && activeSource !== undefined)) {
    throw migrationFailure('unsafe_migration_state', 'v2 active source index is inconsistent');
  }
  if (['writing', 'partial', 'complete'].includes(status) && writeAuthorizedAt === undefined) {
    throw migrationFailure('unsafe_migration_state', 'v2 write state lacks authorization');
  }
  if (
    ['prepared', 'scanning', 'ready_for_review'].includes(status) &&
    writeAuthorizedAt !== undefined
  ) {
    throw migrationFailure('unsafe_migration_state', 'v2 pre-write state has authorization');
  }
  if (status === 'paused') {
    if (!stopRecord) {
      throw migrationFailure('unsafe_migration_state', 'v2 paused job lacks a stop record');
    }
    if ((stopRecord.phase === 'writing') !== (writeAuthorizedAt !== undefined)) {
      throw migrationFailure('unsafe_migration_state', 'v2 pause phase is inconsistent');
    }
  } else if (stopRecord !== undefined) {
    throw migrationFailure('unsafe_migration_state', 'v2 non-paused job has a stop record');
  }
  if (stopRecord && stopRecord.scanRevision !== job.scanRevision) {
    throw migrationFailure('unsafe_migration_state', 'v2 stop record revision is stale');
  }
  if (checkpoint) {
    if (
      checkpoint.adapterVersion !== job.adapterVersion ||
      checkpoint.scanRevision !== job.scanRevision ||
      checkpoint.scannedCount !== job.summary.scannedCount ||
      job.summary.uniqueItemCount > checkpoint.acceptedCount ||
      Date.parse(checkpoint.updatedAt) > Date.parse(updatedAt)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 checkpoint does not match its job');
    }
    if (
      stopRecord &&
      (stopRecord.scannedCount !== checkpoint.scannedCount ||
        stopRecord.acceptedCount !== checkpoint.acceptedCount)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 stop counts are inconsistent');
    }
  } else if (job.summary.scannedCount !== 0 || job.summary.uniqueItemCount !== 0) {
    throw migrationFailure('unsafe_migration_state', 'v2 scan results lack a checkpoint');
  }
  if (job.summary.uniqueItemCount > job.budgets.maxItems) {
    throw migrationFailure('unsafe_migration_state', 'v2 job exceeds its item budget');
  }
  return job;
}

function migrateV1Rows(valuesByStore: Readonly<Record<SyncStoreName, readonly unknown[]>>): {
  jobs: SyncJobRow[];
  items: SyncJobItemRow[];
  records: SyncRecord[];
} {
  const totalRows = Object.values(valuesByStore).reduce((sum, values) => sum + values.length, 0);
  if (totalRows > MAX_MIGRATION_ROWS) {
    throw migrationFailure('migration_budget_exceeded', 'v1 database exceeds migration row limit');
  }
  let totalBytes = 0;
  let totalNodes = 0;
  for (const values of Object.values(valuesByStore)) {
    for (const value of values) {
      const metrics = inspectMigrationValue(value);
      totalBytes += metrics.bytes;
      totalNodes += metrics.nodes;
      if (totalBytes > MAX_MIGRATION_BYTES) {
        throw migrationFailure(
          'migration_budget_exceeded',
          'v1 database exceeds migration byte limit',
        );
      }
      if (totalNodes > MAX_MIGRATION_NODES) {
        throw migrationFailure(
          'migration_budget_exceeded',
          'v1 database exceeds migration structure limit',
        );
      }
    }
  }
  if (valuesByStore.intents.length !== 0) {
    throw migrationFailure('unsafe_migration_state', 'v1 database has unresolved write intents');
  }
  if (valuesByStore.meta.length !== 1) {
    throw migrationFailure('invalid_database_layout', 'v1 schema metadata is incomplete');
  }
  const meta = migrationRecord(
    valuesByStore.meta[0],
    ['key', 'schemaVersion', 'databaseVersion'],
    [],
    'v1 schema metadata',
  );
  if (meta.key !== 'schema' || meta.schemaVersion !== 1 || meta.databaseVersion !== 1) {
    throw migrationFailure('invalid_database_layout', 'v1 schema metadata is invalid');
  }

  const legacyJobs = valuesByStore.jobs.map(parseLegacyV1JobRow);
  const legacyItems = valuesByStore.items.map(parseLegacyV1JobItemRow);
  const records = valuesByStore.records.map((value) => SyncRecordSchema.parse(value));
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  if (recordsByKey.size !== records.length) {
    throw migrationFailure('unsafe_migration_state', 'v1 database has duplicate record keys');
  }
  const canonicalUrls = new Set(records.map((record) => record.canonicalUrl));
  const contentHashes = new Set(records.map((record) => record.contentHash));
  if (canonicalUrls.size !== records.length || contentHashes.size !== records.length) {
    throw migrationFailure('unsafe_migration_state', 'v1 catalog identities are ambiguous');
  }
  const jobsById = new Map(legacyJobs.map((job) => [job.id, job]));
  if (jobsById.size !== legacyJobs.length) {
    throw migrationFailure('unsafe_migration_state', 'v1 database has duplicate job IDs');
  }
  const itemsByJob = new Map<string, LegacyV1JobItemRow[]>();
  for (const item of legacyItems) {
    if (!jobsById.has(item.jobId)) {
      throw migrationFailure('unsafe_migration_state', 'v1 database has an orphan job item');
    }
    const group = itemsByJob.get(item.jobId) ?? [];
    group.push(item);
    itemsByJob.set(item.jobId, group);
  }

  const migratedItems: SyncJobItemRow[] = [];
  const migratedJobs: SyncJobRow[] = [];
  for (const legacyJob of legacyJobs) {
    if (
      legacyJob.status === 'writing' ||
      legacyJob.status === 'partial' ||
      (legacyJob.status === 'paused' && legacyJob.writeAuthorizedAt !== undefined)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v1 database has an active write state');
    }
    const jobItems = itemsByJob.get(legacyJob.id) ?? [];
    const isTerminal = ['complete', 'failed', 'cancelled'].includes(legacyJob.status);
    let acceptedBytes = 0;
    let classificationPendingCount = 0;
    let classificationErrorCount = 0;
    let candidateCount = 0;
    let catalogExistingObservationCount = 0;
    let unreviewedCount = 0;
    let selectedCount = 0;
    let excludedCount = 0;
    let writePendingCount = 0;
    let createdCount = 0;
    let alreadyExistsCount = 0;
    let skippedCount = 0;
    let writeErrorCount = 0;

    for (const legacyItem of jobItems) {
      if (legacyItem.item.source !== legacyJob.source) {
        throw migrationFailure('unsafe_migration_state', 'v1 item source differs from its job');
      }
      if (
        Date.parse(legacyItem.discoveredAt) < Date.parse(legacyJob.createdAt) ||
        Date.parse(legacyItem.updatedAt) > Date.parse(legacyJob.updatedAt)
      ) {
        throw migrationFailure('unsafe_migration_state', 'v1 item timestamps exceed its job');
      }
      acceptedBytes += encoder.encode(JSON.stringify(legacyItem.item)).byteLength;
      if (acceptedBytes > SYNC_LIMITS.maxAcceptedBytesPerJob) {
        throw migrationFailure(
          'migration_budget_exceeded',
          'v1 job exceeds the accepted-byte limit',
        );
      }
      classificationPendingCount += legacyItem.classification === 'pending' ? 1 : 0;
      classificationErrorCount += legacyItem.classification === 'error' ? 1 : 0;
      candidateCount += ['new', 'changed', 'incomplete', 'error'].includes(
        legacyItem.classification,
      )
        ? 1
        : 0;
      catalogExistingObservationCount += legacyItem.classification === 'existing' ? 1 : 0;
      writePendingCount += legacyItem.writeStatus === 'pending' ? 1 : 0;
      createdCount += legacyItem.writeStatus === 'created' ? 1 : 0;
      alreadyExistsCount += legacyItem.writeStatus === 'already_exists' ? 1 : 0;
      skippedCount += legacyItem.writeStatus === 'skipped' ? 1 : 0;
      writeErrorCount += legacyItem.writeStatus === 'error' ? 1 : 0;

      let reviewDecision: SyncReviewDecision = 'unreviewed';
      let reviewRevision = 0;
      if (isTerminal) {
        if (legacyItem.writeStatus === 'pending') {
          throw migrationFailure(
            'unsafe_migration_state',
            'v1 terminal history contains a pending write item',
          );
        }
        reviewDecision = legacyItem.outcome === undefined ? 'excluded' : 'selected';
        reviewRevision = 1;
        if (
          legacyItem.outcome &&
          (legacyItem.outcome.status === 'created' ||
            legacyItem.outcome.status === 'already_exists')
        ) {
          const record = recordsByKey.get(
            makeSyncRecordKey(legacyItem.item.source, legacyItem.sourceItemId),
          );
          if (
            !record ||
            record.canonicalUrl !== legacyItem.item.canonicalUrl ||
            record.contentHash !== legacyItem.item.contentHash ||
            record.relativePath !== legacyItem.outcome.relativePath ||
            record.completeness !== legacyItem.item.completeness ||
            record.extractorVersion !== legacyItem.item.extractorVersion
          ) {
            throw migrationFailure(
              'unsafe_migration_state',
              'v1 terminal write outcome lacks a matching catalog record',
            );
          }
        }
      } else if (legacyItem.writeStatus !== 'not_requested' || legacyItem.outcome !== undefined) {
        throw migrationFailure(
          'unsafe_migration_state',
          'v1 active scan/review data entered the write protocol',
        );
      }
      unreviewedCount += reviewDecision === 'unreviewed' ? 1 : 0;
      selectedCount += reviewDecision === 'selected' ? 1 : 0;
      excludedCount += reviewDecision === 'excluded' ? 1 : 0;
      migratedItems.push(
        SyncJobItemRowSchema.parse({
          ...legacyItem,
          reviewDecision,
          reviewRevision,
        }),
      );
    }

    const derivedLegacyErrorCount = classificationErrorCount + writeErrorCount;
    if (
      legacyJob.summary.uniqueItemCount !== jobItems.length ||
      legacyJob.summary.pendingReviewCount !== classificationPendingCount ||
      legacyJob.summary.writePendingCount !== writePendingCount ||
      legacyJob.summary.createdCount !== createdCount ||
      legacyJob.summary.alreadyExistsCount !== alreadyExistsCount ||
      legacyJob.summary.skippedCount !== skippedCount ||
      legacyJob.summary.errorCount !== derivedLegacyErrorCount
    ) {
      throw migrationFailure('unsafe_migration_state', 'v1 job summary differs from item rows');
    }

    const status = legacyJob.status === 'scanning' ? 'paused' : legacyJob.status;
    const reviewRevision = isTerminal ? 1 : 0;
    const checkpoint = legacyJob.checkpoint
      ? {
          ...legacyJob.checkpoint,
          contractVersion: SYNC_JOB_CONTRACT_VERSION,
          scanRevision: 0,
          acceptedBytes,
          candidateCount,
          classificationErrorCount,
          catalogExistingObservationCount,
          consecutiveKnownIds: 0,
        }
      : undefined;
    const stopRecord =
      status === 'paused'
        ? {
            code: 'worker_interrupted' as const,
            stoppedAt: legacyJob.updatedAt,
            phase: 'scanning' as const,
            scanRevision: 0,
            scannedCount: legacyJob.checkpoint?.scannedCount ?? 0,
            acceptedCount: legacyJob.checkpoint?.acceptedCount ?? 0,
          }
        : undefined;
    const authorizedReviewRevision =
      legacyJob.writeAuthorizedAt === undefined ? undefined : reviewRevision;
    const scanCompletion = [
      'ready_for_review',
      'writing',
      'partial',
      'complete',
      'failed',
      'cancelled',
    ].includes(status)
      ? ('legacy_migrated' as const)
      : undefined;
    migratedJobs.push(
      SyncJobRowSchema.parse({
        ...legacyJob,
        contractVersion: SYNC_JOB_CONTRACT_VERSION,
        scanMode: 'incremental',
        status,
        scanRevision: 0,
        reviewRevision,
        ...(authorizedReviewRevision === undefined ? {} : { authorizedReviewRevision }),
        ...(stopRecord === undefined ? {} : { stopRecord }),
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(scanCompletion === undefined ? {} : { scanCompletion }),
        summary: {
          scannedCount: legacyJob.summary.scannedCount,
          uniqueItemCount: jobItems.length,
          pendingReviewCount: classificationPendingCount,
          classificationErrorCount,
          unreviewedCount,
          selectedCount,
          excludedCount,
          writePendingCount,
          createdCount,
          alreadyExistsCount,
          skippedCount,
          writeErrorCount,
        },
        ...(ACTIVE_SYNC_JOB_STATUSES.has(status) ? { activeSource: legacyJob.source } : {}),
      }),
    );
  }

  return { jobs: migratedJobs, items: migratedItems, records };
}

function migrateV2Rows(valuesByStore: Readonly<Record<SyncStoreName, readonly unknown[]>>): {
  jobs: SyncJobRow[];
  items: SyncJobItemRow[];
  records: SyncRecord[];
  intents: WriteIntent[];
} {
  const totalRows = Object.values(valuesByStore).reduce((sum, values) => sum + values.length, 0);
  if (totalRows > MAX_MIGRATION_ROWS) {
    throw migrationFailure('migration_budget_exceeded', 'v2 database exceeds migration row limit');
  }
  let totalBytes = 0;
  let totalNodes = 0;
  for (const values of Object.values(valuesByStore)) {
    for (const value of values) {
      const metrics = inspectMigrationValue(value);
      totalBytes += metrics.bytes;
      totalNodes += metrics.nodes;
      if (totalBytes > MAX_MIGRATION_BYTES) {
        throw migrationFailure(
          'migration_budget_exceeded',
          'v2 database exceeds migration byte limit',
        );
      }
      if (totalNodes > MAX_MIGRATION_NODES) {
        throw migrationFailure(
          'migration_budget_exceeded',
          'v2 database exceeds migration structure limit',
        );
      }
    }
  }
  if (valuesByStore.meta.length !== 1) {
    throw migrationFailure('invalid_database_layout', 'v2 schema metadata is incomplete');
  }
  const meta = migrationRecord(
    valuesByStore.meta[0],
    ['key', 'schemaVersion', 'databaseVersion'],
    [],
    'v2 schema metadata',
  );
  if (
    meta.key !== 'schema' ||
    meta.schemaVersion !== SYNC_SCHEMA_VERSION ||
    meta.databaseVersion !== 2
  ) {
    throw migrationFailure('invalid_database_layout', 'v2 schema metadata is invalid');
  }

  let legacyJobs: LegacyV2JobRow[];
  let items: SyncJobItemRow[];
  let records: SyncRecord[];
  let intents: WriteIntent[];
  try {
    legacyJobs = valuesByStore.jobs.map(parseLegacyV2JobRow);
    items = valuesByStore.items.map((value) => SyncJobItemRowSchema.parse(value));
    records = valuesByStore.records.map((value) => SyncRecordSchema.parse(value));
    intents = valuesByStore.intents.map((value) => WriteIntentSchema.parse(value));
  } catch (error) {
    throw migrationFailure('unsafe_migration_state', 'v2 rows failed strict validation', error);
  }

  const jobsById = new Map(legacyJobs.map((job) => [job.id, job]));
  const itemsByKey = new Map(items.map((item) => [item.key, item]));
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const intentsById = new Map(intents.map((intent) => [intent.id, intent]));
  if (
    jobsById.size !== legacyJobs.length ||
    itemsByKey.size !== items.length ||
    recordsByKey.size !== records.length ||
    intentsById.size !== intents.length
  ) {
    throw migrationFailure('unsafe_migration_state', 'v2 database contains duplicate keys');
  }
  if (
    new Set(records.map((record) => record.canonicalUrl)).size !== records.length ||
    new Set(records.map((record) => record.contentHash)).size !== records.length
  ) {
    throw migrationFailure('unsafe_migration_state', 'v2 catalog identities are ambiguous');
  }

  const itemsByJob = new Map<string, SyncJobItemRow[]>();
  for (const item of items) {
    const job = jobsById.get(item.jobId);
    if (!job) {
      throw migrationFailure('unsafe_migration_state', 'v2 database has an orphan job item');
    }
    if (item.item.source !== job.source) {
      throw migrationFailure('unsafe_migration_state', 'v2 item source differs from its job');
    }
    if (
      Date.parse(item.discoveredAt) < Date.parse(job.createdAt) ||
      Date.parse(item.updatedAt) > Date.parse(job.updatedAt)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 item timestamps exceed its job');
    }
    const group = itemsByJob.get(item.jobId) ?? [];
    group.push(item);
    itemsByJob.set(item.jobId, group);
  }

  const intentsByJob = new Map<string, WriteIntent[]>();
  const intentItemKeys = new Set<string>();
  for (const intent of intents) {
    const job = jobsById.get(intent.jobId);
    const item = itemsByKey.get(intent.itemKey);
    if (!job || !item || !intentMatchesJobItem(intent, item)) {
      throw migrationFailure('unsafe_migration_state', 'v2 write intent is orphaned or stale');
    }
    if (
      intentItemKeys.has(intent.itemKey) ||
      item.writeStatus !== 'pending' ||
      item.reviewDecision !== 'selected' ||
      item.reviewRevision !== intent.reviewRevision ||
      job.reviewRevision !== intent.reviewRevision ||
      job.authorizedReviewRevision !== intent.reviewRevision
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 write intent state is inconsistent');
    }
    intentItemKeys.add(intent.itemKey);
    const group = intentsByJob.get(intent.jobId) ?? [];
    group.push(intent);
    intentsByJob.set(intent.jobId, group);
  }

  const migratedJobs: SyncJobRow[] = [];
  for (const legacyJob of legacyJobs) {
    const jobItems = itemsByJob.get(legacyJob.id) ?? [];
    const pendingReviewCount = jobItems.filter((item) => item.classification === 'pending').length;
    const classificationErrorCount = jobItems.filter(
      (item) => item.classification === 'error',
    ).length;
    const candidateCount = jobItems.filter((item) =>
      ['new', 'changed', 'incomplete', 'error'].includes(item.classification),
    ).length;
    const catalogExistingObservationCount = jobItems.filter(
      (item) => item.classification === 'existing',
    ).length;
    const unreviewedCount = jobItems.filter((item) => item.reviewDecision === 'unreviewed').length;
    const selectedCount = jobItems.filter((item) => item.reviewDecision === 'selected').length;
    const excludedCount = jobItems.filter((item) => item.reviewDecision === 'excluded').length;
    const writePendingCount = jobItems.filter((item) => item.writeStatus === 'pending').length;
    const createdCount = jobItems.filter((item) => item.writeStatus === 'created').length;
    const alreadyExistsCount = jobItems.filter(
      (item) => item.writeStatus === 'already_exists',
    ).length;
    const skippedCount = jobItems.filter((item) => item.writeStatus === 'skipped').length;
    const writeErrorCount = jobItems.filter((item) => item.writeStatus === 'error').length;
    const summary = legacyJob.summary;
    if (
      summary.uniqueItemCount !== jobItems.length ||
      summary.pendingReviewCount !== pendingReviewCount ||
      summary.classificationErrorCount !== classificationErrorCount ||
      summary.unreviewedCount !== unreviewedCount ||
      summary.selectedCount !== selectedCount ||
      summary.excludedCount !== excludedCount ||
      summary.writePendingCount !== writePendingCount ||
      summary.createdCount !== createdCount ||
      summary.alreadyExistsCount !== alreadyExistsCount ||
      summary.skippedCount !== skippedCount ||
      summary.writeErrorCount !== writeErrorCount ||
      (intentsByJob.get(legacyJob.id)?.length ?? 0) !== writePendingCount
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 job summary differs from item rows');
    }
    for (const item of jobItems) {
      if (
        item.reviewDecision !== 'unreviewed' &&
        item.reviewRevision !== legacyJob.reviewRevision
      ) {
        throw migrationFailure('unsafe_migration_state', 'v2 item review revision is stale');
      }
    }

    const status = legacyJob.status === 'scanning' ? 'paused' : legacyJob.status;
    const checkpoint = legacyJob.checkpoint
      ? SyncCheckpointSchema.parse({
          ...legacyJob.checkpoint,
          contractVersion: SYNC_JOB_CONTRACT_VERSION,
          candidateCount,
          classificationErrorCount,
          catalogExistingObservationCount,
          consecutiveKnownIds: 0,
        })
      : undefined;
    if (
      checkpoint &&
      (candidateCount > checkpoint.acceptedCount ||
        catalogExistingObservationCount > checkpoint.acceptedCount)
    ) {
      throw migrationFailure('unsafe_migration_state', 'v2 checkpoint does not cover its rows');
    }
    const stopRecord =
      legacyJob.status === 'scanning'
        ? {
            code: 'worker_interrupted' as const,
            stoppedAt: legacyJob.updatedAt,
            phase: 'scanning' as const,
            scanRevision: legacyJob.scanRevision,
            scannedCount: checkpoint?.scannedCount ?? 0,
            acceptedCount: checkpoint?.acceptedCount ?? 0,
          }
        : legacyJob.stopRecord;
    const scanCompletion =
      ['ready_for_review', 'writing', 'partial', 'complete', 'failed', 'cancelled'].includes(
        status,
      ) ||
      (status === 'paused' && stopRecord?.phase === 'writing')
        ? ('legacy_migrated' as const)
        : undefined;
    migratedJobs.push(
      SyncJobRowSchema.parse({
        ...legacyJob,
        contractVersion: SYNC_JOB_CONTRACT_VERSION,
        scanMode: 'incremental',
        status,
        ...(scanCompletion === undefined ? {} : { scanCompletion }),
        ...(stopRecord === undefined ? {} : { stopRecord }),
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(ACTIVE_SYNC_JOB_STATUSES.has(status) ? { activeSource: legacyJob.source } : {}),
      }),
    );
  }

  return { jobs: migratedJobs, items, records, intents };
}

function migrateLegacyToV3(
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: 1 | 2,
  onError: (error: unknown) => void,
): void {
  assertDatabaseLayout(database, transaction);
  const valuesByStore: Record<SyncStoreName, unknown[]> = {
    jobs: [],
    items: [],
    records: [],
    intents: [],
    meta: [],
  };
  let totalRows = 0;
  let totalBytes = 0;
  let totalNodes = 0;
  let failed = false;
  const fail = (error: unknown): void => {
    if (failed) {
      return;
    }
    failed = true;
    onError(normalizeMigrationError(error));
    try {
      transaction.abort();
    } catch {
      // The versionchange transaction may already be aborting.
    }
  };

  const writeMigratedRows = (): void => {
    try {
      const migrated =
        oldVersion === 1
          ? { ...migrateV1Rows(valuesByStore), intents: [] as WriteIntent[] }
          : migrateV2Rows(valuesByStore);
      const writes: IDBRequest<IDBValidKey>[] = [];
      for (const job of migrated.jobs) {
        writes.push(transaction.objectStore('jobs').put(job));
      }
      for (const item of migrated.items) {
        writes.push(transaction.objectStore('items').put(item));
      }
      for (const record of migrated.records) {
        writes.push(transaction.objectStore('records').put(record));
      }
      for (const intent of migrated.intents) {
        writes.push(transaction.objectStore('intents').put(intent));
      }
      writes.push(
        transaction.objectStore('meta').put({
          key: 'schema',
          schemaVersion: SYNC_SCHEMA_VERSION,
          databaseVersion: SYNC_DATABASE_VERSION,
          validationState: 'pending',
        } satisfies SyncMeta),
      );
      for (const write of writes) {
        write.addEventListener('error', () => {
          fail(
            new SyncStoreMigrationError('unsafe_migration_state', 'Failed to write v3 rows', {
              cause: write.error,
            }),
          );
        });
      }
    } catch (error) {
      fail(error);
    }
  };

  const readStore = (storeIndex: number): void => {
    if (failed) {
      return;
    }
    const storeName = SYNC_STORE_NAMES[storeIndex];
    if (storeName === undefined) {
      writeMigratedRows();
      return;
    }

    const request = transaction.objectStore(storeName).openCursor();
    request.addEventListener('error', () => {
      fail(
        new SyncStoreMigrationError(
          'unsafe_migration_state',
          `Failed to read v${oldVersion} ${storeName} rows`,
          { cause: request.error },
        ),
      );
    });
    request.addEventListener('success', () => {
      if (failed) {
        return;
      }
      const cursor = request.result;
      if (!cursor) {
        readStore(storeIndex + 1);
        return;
      }
      try {
        totalRows += 1;
        if (totalRows > MAX_MIGRATION_ROWS) {
          throw migrationFailure(
            'migration_budget_exceeded',
            `v${oldVersion} database exceeds migration row limit`,
          );
        }
        const metrics = inspectMigrationValue(cursor.value);
        totalBytes += metrics.bytes;
        totalNodes += metrics.nodes;
        if (totalBytes > MAX_MIGRATION_BYTES) {
          throw migrationFailure(
            'migration_budget_exceeded',
            `v${oldVersion} database exceeds migration byte limit`,
          );
        }
        if (totalNodes > MAX_MIGRATION_NODES) {
          throw migrationFailure(
            'migration_budget_exceeded',
            `v${oldVersion} database exceeds migration structure limit`,
          );
        }
        valuesByStore[storeName].push(cursor.value);
        cursor.continue();
      } catch (error) {
        fail(error);
      }
    });
  };

  readStore(0);
}

function openRawDatabase(
  factory: IDBFactory,
  dbName: string,
  onBlocked?: (event: SyncStoreVersionEvent) => void,
): Promise<{ database: IDBDatabase; upgradedFrom?: number }> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, SYNC_DATABASE_VERSION);
    let settled = false;
    let upgradeError: unknown;
    let upgradedFrom: number | undefined;

    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    request.addEventListener('upgradeneeded', (event) => {
      if (event.newVersion !== SYNC_DATABASE_VERSION) {
        upgradeError = new SyncStoreMigrationError(
          'unsupported_database_version',
          'The requested sync database version is unsupported',
        );
        request.transaction?.abort();
        return;
      }

      try {
        upgradedFrom = event.oldVersion;
        if (event.oldVersion === 0) {
          createV3Database(request.result);
        } else if ((event.oldVersion === 1 || event.oldVersion === 2) && request.transaction) {
          migrateLegacyToV3(request.result, request.transaction, event.oldVersion, (error) => {
            upgradeError = error;
          });
        } else {
          throw new SyncStoreMigrationError(
            'unsupported_database_version',
            'Only database versions 1 and 2 can be migrated to database version 3',
          );
        }
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
            'The sync database is newer than database version 3',
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
      resolve({
        database: request.result,
        ...(upgradedFrom === undefined ? {} : { upgradedFrom }),
      });
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

async function validateV3RowsAfterUpgrade(database: IDBPDatabase<SyncDatabase>): Promise<void> {
  const snapshot = await readTransaction(database, SYNC_STORE_NAMES, async (transaction) => {
    const stores = {
      jobs: transaction.objectStore('jobs'),
      items: transaction.objectStore('items'),
      records: transaction.objectStore('records'),
      intents: transaction.objectStore('intents'),
      meta: transaction.objectStore('meta'),
    };
    const counts = await Promise.all([
      stores.jobs.count(),
      stores.items.count(),
      stores.records.count(),
      stores.intents.count(),
      stores.meta.count(),
    ]);
    if (counts.reduce((sum, count) => sum + count, 0) > MAX_MIGRATION_ROWS) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 exceeds the post-upgrade row validation budget',
      );
    }
    const [jobs, items, records, intents, meta] = await Promise.all([
      stores.jobs.getAll(),
      stores.items.getAll(),
      stores.records.getAll(),
      stores.intents.getAll(),
      stores.meta.getAll(),
    ]);
    return { jobs, items, records, intents, meta };
  });
  if (snapshot.meta.length !== 1) {
    throw new SyncStoreMigrationError(
      'DB3_REOPEN_VALIDATION_FAILED',
      'DB3 schema metadata is incomplete or ambiguous',
    );
  }
  parsePersistedRow(SyncMetaSchema, snapshot.meta[0], 'meta', 'schema');
  const jobs = snapshot.jobs.map((value, index) =>
    parsePersistedRow(SyncJobRowSchema, value, 'jobs', index),
  );
  const items = snapshot.items.map((value, index) =>
    parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
  );
  const records = snapshot.records.map((value, index) =>
    parsePersistedRow(SyncRecordSchema, value, 'records', index),
  );
  const intents = snapshot.intents.map((value, index) =>
    parsePersistedRow(WriteIntentSchema, value, 'intents', index),
  );
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const itemsByKey = new Map(items.map((item) => [item.key, item]));
  if (jobsById.size !== jobs.length || itemsByKey.size !== items.length) {
    throw new SyncStoreMigrationError(
      'DB3_REOPEN_VALIDATION_FAILED',
      'DB3 contains duplicate job or item identities',
    );
  }
  const itemsByJob = new Map<string, SyncJobItemRow[]>();
  for (const item of items) {
    const job = jobsById.get(item.jobId);
    if (!job || item.item.source !== job.source) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 contains an orphan or cross-source item',
      );
    }
    const group = itemsByJob.get(item.jobId) ?? [];
    group.push(item);
    itemsByJob.set(item.jobId, group);
  }
  if (
    new Set(records.map((record) => record.key)).size !== records.length ||
    new Set(records.map((record) => record.canonicalUrl)).size !== records.length ||
    new Set(records.map((record) => record.contentHash)).size !== records.length
  ) {
    throw new SyncStoreMigrationError(
      'DB3_REOPEN_VALIDATION_FAILED',
      'DB3 catalog identities are ambiguous',
    );
  }
  for (const job of jobs) {
    const jobItems = itemsByJob.get(job.id) ?? [];
    const candidateCount = jobItems.filter((item) =>
      ['new', 'changed', 'incomplete', 'error'].includes(item.classification),
    ).length;
    const errorCount = jobItems.filter((item) => item.classification === 'error').length;
    const existingRows = jobItems.filter((item) => item.classification === 'existing').length;
    if (
      jobItems.length !== job.summary.uniqueItemCount ||
      errorCount !== job.summary.classificationErrorCount ||
      (job.checkpoint?.candidateCount ?? 0) !== candidateCount ||
      (job.checkpoint?.classificationErrorCount ?? 0) !== errorCount ||
      (job.checkpoint?.catalogExistingObservationCount ?? 0) < existingRows
    ) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 job counters differ from persisted item rows',
      );
    }
  }
  const intentItems = new Set<string>();
  for (const intent of intents) {
    const job = jobsById.get(intent.jobId);
    const item = itemsByKey.get(intent.itemKey);
    if (
      !job ||
      !item ||
      intentItems.has(intent.itemKey) ||
      !intentMatchesJobItem(intent, item) ||
      item.writeStatus !== 'pending' ||
      job.authorizedReviewRevision !== intent.reviewRevision
    ) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 contains an unresolved intent with inconsistent identity',
      );
    }
    intentItems.add(intent.itemKey);
  }
}

async function readSyncMeta(database: IDBPDatabase<SyncDatabase>): Promise<SyncMeta> {
  const metaRows = await readTransaction(database, ['meta'] as const, async (transaction) =>
    transaction.objectStore('meta').getAll(),
  );
  if (metaRows.length !== 1) {
    throw new SyncStoreMigrationError(
      'invalid_database_layout',
      'Sync database schema metadata is incomplete or ambiguous',
    );
  }
  return parsePersistedRow(SyncMetaSchema, metaRows[0], 'meta', 'schema');
}

async function writeSyncMetaValidationState(
  database: IDBPDatabase<SyncDatabase>,
  meta: SyncMeta,
  validationState: NonNullable<SyncMeta['validationState']>,
): Promise<SyncMeta> {
  const nextMeta: SyncMeta = { ...meta, validationState };
  return writeTransaction(database, ['meta'] as const, async (transaction) => {
    await transaction.objectStore('meta').put(nextMeta);
    return nextMeta;
  });
}

async function validateSyncDatabaseOnOpen(
  database: IDBPDatabase<SyncDatabase>,
  upgraded: boolean,
): Promise<void> {
  const meta = await readSyncMeta(database);
  if (meta.validationState === 'failed') {
    throw new SyncStoreMigrationError(
      'DB3_REOPEN_VALIDATION_FAILED',
      'DB3 is locked because a prior post-upgrade validation failed',
    );
  }
  if (!upgraded && meta.validationState === 'complete') {
    return;
  }

  try {
    await validateV3RowsAfterUpgrade(database);
    await writeSyncMetaValidationState(database, meta, 'complete');
  } catch (error) {
    try {
      await writeSyncMetaValidationState(database, meta, 'failed');
    } catch {
      // Keep the original validation error. An unreadable marker will also fail closed on reopen.
    }
    throw new SyncStoreMigrationError(
      'DB3_REOPEN_VALIDATION_FAILED',
      'DB3 row validation failed after the upgrade committed',
      { cause: error },
    );
  }
}

function publicJob(row: SyncJobRow): SyncJob {
  return SyncJobSchema.parse({
    schemaVersion: row.schemaVersion,
    contractVersion: row.contractVersion,
    id: row.id,
    source: row.source,
    status: row.status,
    scanMode: row.scanMode,
    ...(row.scanCompletion !== undefined ? { scanCompletion: row.scanCompletion } : {}),
    adapterVersion: row.adapterVersion,
    scanRevision: row.scanRevision,
    reviewRevision: row.reviewRevision,
    ...(row.authorizedReviewRevision !== undefined
      ? { authorizedReviewRevision: row.authorizedReviewRevision }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.writeAuthorizedAt ? { writeAuthorizedAt: row.writeAuthorizedAt } : {}),
    ...(row.stopRecord ? { stopRecord: row.stopRecord } : {}),
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
    reviewDecision: row.reviewDecision,
    reviewRevision: row.reviewRevision,
    writeStatus: row.writeStatus,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    discoveredAt: row.discoveredAt,
    updatedAt: row.updatedAt,
  });
}

function rowWithStatus(
  row: SyncJobRow,
  status: SyncJobStatus,
  updatedAt: string,
  updates: Readonly<{ scanCompletion?: SyncScanCompletion }> = {},
): SyncJobRow {
  const candidate: Record<string, unknown> = {
    ...row,
    status,
    updatedAt,
    ...updates,
  };
  if (ACTIVE_SYNC_JOB_STATUSES.has(status)) {
    candidate.activeSource = row.source;
  } else {
    delete candidate.activeSource;
  }
  if (status !== 'paused') {
    delete candidate.stopRecord;
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

function assertRevision(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new RangeError(`${label} must be an integer between 0 and 1000000`);
  }
  return value;
}

function readBoundedPlainArray(value: unknown, maximum: number, label: string): unknown[] {
  let isArray: boolean;
  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    prototype = isArray ? Object.getPrototypeOf(value) : null;
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, 'length') : undefined;
  } catch {
    throw new TypeError(`${label} could not be inspected`);
  }
  if (!isArray || prototype !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximum
  ) {
    throw new RangeError(`${label} exceeds its item limit`);
  }
  const length = lengthDescriptor.value as number;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${label} could not be inspected`);
  }
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== length) {
    throw new TypeError(`${label} must not contain sparse or extra properties`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must not contain accessors`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function parseSelectedSourceItemIds(value: readonly string[]): string[] {
  const parsed = readBoundedPlainArray(value, MAX_LIST_RESULTS, 'selectedSourceItemIds').map(
    (sourceItemId) => SourceItemIdSchema.parse(sourceItemId),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw new SyncStoreConflictError('Review selection contains duplicate source item IDs');
  }
  return [...parsed].sort();
}

function isReviewEligible(item: SyncJobItemRow): boolean {
  return (
    item.classification === 'new' &&
    (item.item.completeness === 'complete' || item.item.completeness === 'summary_only')
  );
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

function sameStableSocialItem(left: SocialItem, right: SocialItem): boolean {
  return (
    left.source === right.source &&
    left.sourceItemId === right.sourceItemId &&
    left.canonicalUrl === right.canonicalUrl &&
    left.contentHash === right.contentHash &&
    left.completeness === right.completeness &&
    left.extractorVersion === right.extractorVersion
  );
}

function itemMatchesCatalogIdentity(item: SocialItem, record: SyncRecord): boolean {
  return (
    item.source === record.source &&
    item.sourceItemId === record.sourceItemId &&
    item.canonicalUrl === record.canonicalUrl &&
    item.contentHash === record.contentHash &&
    item.completeness === record.completeness &&
    item.extractorVersion === record.extractorVersion
  );
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
    left.extractorVersion === right.extractorVersion &&
    left.reviewRevision === right.reviewRevision
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
    intent.extractorVersion === item.item.extractorVersion &&
    intent.reviewRevision === item.reviewRevision
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
  guard: {
    readonly signal?: AbortSignal;
    readonly beforeCommit?: () => boolean;
  } = {},
): Promise<Result> {
  if (guard.signal?.aborted) {
    throw new SyncStoreConflictError('Sync transaction was aborted before it started');
  }
  const transaction = database.transaction(storeNames, 'readwrite', { durability: 'strict' });
  const abortTransaction = () => {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
  };
  guard.signal?.addEventListener('abort', abortTransaction, { once: true });
  try {
    const result = await operation(transaction);
    if (guard.signal?.aborted || guard.beforeCommit?.() === false) {
      abortTransaction();
      throw new SyncStoreConflictError('Sync transaction deadline expired before commit');
    }
    await transaction.done;
    return result;
  } catch (error) {
    abortTransaction();
    await transaction.done.catch(() => undefined);
    throw error;
  } finally {
    guard.signal?.removeEventListener('abort', abortTransaction);
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
    const scanMode = SyncScanModeSchema.parse(input.scanMode ?? 'incremental');
    const budgets = SyncBudgetsSchema.parse(input.budgets);
    const row = SyncJobRowSchema.parse({
      schemaVersion: SYNC_SCHEMA_VERSION,
      contractVersion: SYNC_JOB_CONTRACT_VERSION,
      id,
      source,
      status: 'prepared',
      scanMode,
      adapterVersion: input.adapterVersion,
      scanRevision: 0,
      reviewRevision: 0,
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
            existing.scanMode === scanMode &&
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

  async claimScanRevision(
    jobId: string,
    expectedScanRevisionInput: number,
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const value = await jobs.get(id);
      if (value === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
      const canStart = current.status === 'prepared';
      const canResume =
        current.status === 'paused' &&
        current.stopRecord?.phase === 'scanning' &&
        current.writeAuthorizedAt === undefined;
      if (!canStart && !canResume) {
        throw new SyncStoreConflictError('The job is not ready to start or resume scanning');
      }
      if (current.scanRevision !== expectedScanRevision) {
        throw new SyncStoreConflictError('Scan revision is stale');
      }
      if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
        throw new SyncStoreConflictError('Job timestamps must be monotonic');
      }
      const scanRevision = current.scanRevision + 1;
      const candidate: Record<string, unknown> = {
        ...current,
        status: 'scanning',
        scanRevision,
        updatedAt,
        activeSource: current.source,
      };
      delete candidate.stopRecord;
      if (current.checkpoint) {
        candidate.checkpoint = {
          ...current.checkpoint,
          scanRevision,
          updatedAt,
        };
      }
      const next = SyncJobRowSchema.parse(candidate);
      await jobs.put(next);
      return publicJob(next);
    });
  }

  async pauseJobWithStopRecord(
    jobId: string,
    expectedScanRevisionInput: number,
    reasonInput: SyncStopReason,
    phaseInput: 'scanning' | 'writing',
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const reason = SyncStopReasonSchema.parse(reasonInput);
    const phase = phaseInput === 'scanning' || phaseInput === 'writing' ? phaseInput : undefined;
    if (!phase) {
      throw new TypeError('phase must be scanning or writing');
    }
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const value = await jobs.get(id);
      if (value === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
      if (current.status !== phase) {
        throw new SyncStoreConflictError('Stop phase does not match the active job phase');
      }
      if (current.scanRevision !== expectedScanRevision) {
        throw new SyncStoreConflictError('Scan revision is stale');
      }
      if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
        throw new SyncStoreConflictError('Job timestamps must be monotonic');
      }
      const next = SyncJobRowSchema.parse({
        ...current,
        status: 'paused',
        updatedAt,
        stopRecord: {
          code: reason,
          stoppedAt: updatedAt,
          phase,
          scanRevision: current.scanRevision,
          scannedCount: current.checkpoint?.scannedCount ?? 0,
          acceptedCount: current.checkpoint?.acceptedCount ?? 0,
        },
        activeSource: current.source,
      });
      await jobs.put(next);
      return publicJob(next);
    });
  }

  async recoverInterruptedScanningJobs(updatedAtInput?: string): Promise<SyncJob[]> {
    this.assertOpen();
    const requestedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    return writeTransaction(this.database, ['jobs'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const values = await jobs.index('by-status').getAll('scanning', MAX_LIST_RESULTS);
      const recovered: SyncJob[] = [];
      for (const [index, value] of values.entries()) {
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', index);
        const updatedAt =
          Date.parse(requestedAt) < Date.parse(current.updatedAt) ? current.updatedAt : requestedAt;
        const next = SyncJobRowSchema.parse({
          ...current,
          status: 'paused',
          updatedAt,
          stopRecord: {
            code: 'worker_interrupted',
            stoppedAt: updatedAt,
            phase: 'scanning',
            scanRevision: current.scanRevision,
            scannedCount: current.checkpoint?.scannedCount ?? 0,
            acceptedCount: current.checkpoint?.acceptedCount ?? 0,
          },
          activeSource: current.source,
        });
        await jobs.put(next);
        recovered.push(publicJob(next));
      }
      return recovered;
    });
  }

  async finishScan(
    jobId: string,
    expectedScanRevisionInput: number,
    updatedAtInput?: string,
    guard: ScanTransactionGuard & { readonly scanCompletion?: SyncScanCompletion } = {},
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    const scanCompletion = SyncScanCompletionSchema.parse(
      guard.scanCompletion ?? 'trusted_terminal',
    );
    if (scanCompletion !== 'trusted_terminal' && scanCompletion !== 'known_frontier') {
      throw new SyncStoreConflictError('finishScan requires a trusted terminal or known frontier');
    }
    return writeTransaction(
      this.database,
      ['jobs', 'items'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const value = await jobs.get(id);
        if (value === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
        if (current.status !== 'scanning' || current.scanRevision !== expectedScanRevision) {
          throw new SyncStoreConflictError('Only the current scanning worker may finish a scan');
        }
        if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
          throw new SyncStoreConflictError('Job timestamps must be monotonic');
        }
        const pending = await transaction
          .objectStore('items')
          .index('by-job-classification')
          .count([id, 'pending']);
        if (pending !== 0) {
          throw new SyncStoreConflictError('A scan cannot finish while items remain unclassified');
        }
        const next = rowWithStatus(current, 'ready_for_review', updatedAt, { scanCompletion });
        await jobs.put(next);
        return publicJob(next);
      },
      guard,
    );
  }

  async finalizePausedScan(
    jobId: string,
    expectedScanRevisionInput: number,
    updatedAtInput?: string,
    guard: ScanTransactionGuard = {},
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        const value = await jobs.get(id);
        if (value === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
        if (
          current.status !== 'paused' ||
          current.stopRecord?.phase !== 'scanning' ||
          !['user_paused', 'budget_exceeded'].includes(current.stopRecord.code) ||
          current.writeAuthorizedAt !== undefined ||
          current.scanCompletion !== undefined
        ) {
          throw new SyncStoreConflictError('This paused scan cannot use its current batch');
        }
        if (current.scanRevision !== expectedScanRevision) {
          throw new SyncStoreConflictError('Scan revision is stale');
        }
        if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
          throw new SyncStoreConflictError('Job timestamps must be monotonic');
        }
        const [pendingClassifications, unresolvedIntents, pendingWrites] = await Promise.all([
          items.index('by-job-classification').count([id, 'pending']),
          intents.index('by-job-id').count(id),
          items.index('by-job-write-status').count([id, 'pending']),
        ]);
        if (pendingClassifications !== 0 || unresolvedIntents !== 0 || pendingWrites !== 0) {
          throw new SyncStoreConflictError('The paused batch still has unresolved work');
        }
        const next = rowWithStatus(current, 'ready_for_review', updatedAt, {
          scanCompletion: 'user_finalized_batch',
        });
        await jobs.put(next);
        return publicJob(next);
      },
      guard,
    );
  }

  async saveReviewSelection(
    jobId: string,
    expectedReviewRevisionInput: number,
    selectedSourceItemIdsInput: readonly string[],
    updatedAtInput?: string,
  ): Promise<SaveReviewSelectionResult> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedReviewRevision = assertRevision(
      expectedReviewRevisionInput,
      'expectedReviewRevision',
    );
    const selectedSourceItemIds = parseSelectedSourceItemIds(selectedSourceItemIdsInput);
    const selected = new Set(selectedSourceItemIds);
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(this.database, ['jobs', 'items'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const items = transaction.objectStore('items');
      const jobValue = await jobs.get(id);
      if (jobValue === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
      if (job.status !== 'ready_for_review' || job.authorizedReviewRevision !== undefined) {
        throw new SyncStoreConflictError('Review selection is not editable in this job state');
      }
      if (job.reviewRevision !== expectedReviewRevision) {
        throw new SyncStoreConflictError('Review revision is stale');
      }
      if (Date.parse(updatedAt) < Date.parse(job.updatedAt)) {
        throw new SyncStoreConflictError('Review timestamps must be monotonic');
      }
      const values = await items.index('by-job-id').getAll(id, MAX_LIST_RESULTS);
      if (values.length !== job.summary.uniqueItemCount) {
        throw new CorruptSyncRowError(
          'jobs',
          id,
          new Error('Review item count differs from the job summary'),
        );
      }
      const rows = values.map((value, index) =>
        parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
      );
      const available = new Set(rows.map((row) => row.sourceItemId));
      if (selectedSourceItemIds.some((sourceItemId) => !available.has(sourceItemId))) {
        throw new SyncStoreConflictError('Review selection contains an unknown item ID');
      }
      for (const row of rows) {
        if (selected.has(row.sourceItemId) && !isReviewEligible(row)) {
          throw new SyncStoreConflictError('Only eligible new items may be selected');
        }
        if (row.writeStatus !== 'not_requested' || row.outcome !== undefined) {
          throw new SyncStoreConflictError('Review selection cannot change after writing starts');
        }
        if (Date.parse(updatedAt) < Date.parse(row.updatedAt)) {
          throw new SyncStoreConflictError('Review timestamps must be monotonic');
        }
      }
      const reviewRevision = job.reviewRevision + 1;
      if (reviewRevision > 1_000_000) {
        throw new SyncStoreConflictError('Review revision limit has been reached');
      }
      const nextRows = rows.map((row) =>
        SyncJobItemRowSchema.parse({
          ...row,
          reviewDecision: selected.has(row.sourceItemId) ? 'selected' : 'excluded',
          reviewRevision,
          updatedAt,
        }),
      );
      const nextJob = SyncJobRowSchema.parse({
        ...job,
        reviewRevision,
        updatedAt,
        summary: {
          ...job.summary,
          unreviewedCount: 0,
          selectedCount: selected.size,
          excludedCount: rows.length - selected.size,
        },
      });
      await Promise.all([...nextRows.map((row) => items.put(row)), jobs.put(nextJob)]);
      return { job: publicJob(nextJob), selectedSourceItemIds };
    });
  }

  async completeReviewWithoutWrites(
    jobId: string,
    expectedReviewRevisionInput: number,
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedReviewRevision = assertRevision(
      expectedReviewRevisionInput,
      'expectedReviewRevision',
    );
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        const jobValue = await jobs.get(id);
        if (jobValue === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
        if (
          job.status !== 'ready_for_review' ||
          job.scanCompletion === undefined ||
          job.writeAuthorizedAt !== undefined ||
          job.authorizedReviewRevision !== undefined
        ) {
          throw new SyncStoreConflictError('The job is not eligible for no-write completion');
        }
        if (job.reviewRevision !== expectedReviewRevision) {
          throw new SyncStoreConflictError('Review revision is stale');
        }
        if (Date.parse(updatedAt) < Date.parse(job.updatedAt)) {
          throw new SyncStoreConflictError('Review timestamps must be monotonic');
        }
        const [values, unresolvedIntents] = await Promise.all([
          items.index('by-job-id').getAll(id, MAX_LIST_RESULTS),
          intents.index('by-job-id').count(id),
        ]);
        const rows = values.map((value, index) =>
          parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
        );
        if (rows.length !== job.summary.uniqueItemCount || unresolvedIntents !== 0) {
          throw new SyncStoreConflictError('No-write completion state is incomplete');
        }
        if (
          rows.some(
            (row) =>
              row.classification === 'pending' ||
              row.writeStatus !== 'not_requested' ||
              row.outcome !== undefined,
          )
        ) {
          throw new SyncStoreConflictError(
            'No-write completion cannot hide pending or written work',
          );
        }
        const classificationErrorCount = rows.filter(
          (row) => row.classification === 'error',
        ).length;
        if (
          classificationErrorCount !== job.summary.classificationErrorCount ||
          classificationErrorCount !== (job.checkpoint?.classificationErrorCount ?? 0)
        ) {
          throw new CorruptSyncRowError(
            'jobs',
            id,
            new Error('Classification error counts differ from persisted items'),
          );
        }
        const reviewRevision = job.reviewRevision + 1;
        if (reviewRevision > 1_000_000) {
          throw new SyncStoreConflictError('Review revision limit has been reached');
        }
        const nextRows = rows.map((row) =>
          SyncJobItemRowSchema.parse({
            ...row,
            reviewDecision: 'excluded',
            reviewRevision,
            updatedAt,
          }),
        );
        const status = classificationErrorCount === 0 ? 'complete' : 'complete_with_issues';
        const nextJobCandidate: Record<string, unknown> = {
          ...job,
          status,
          reviewRevision,
          updatedAt,
          summary: {
            ...job.summary,
            pendingReviewCount: 0,
            classificationErrorCount,
            unreviewedCount: 0,
            selectedCount: 0,
            excludedCount: rows.length,
            writePendingCount: 0,
            createdCount: 0,
            alreadyExistsCount: 0,
            skippedCount: 0,
            writeErrorCount: 0,
          },
        };
        delete nextJobCandidate.activeSource;
        const nextJob = SyncJobRowSchema.parse(nextJobCandidate);
        await Promise.all([...nextRows.map((row) => items.put(row)), jobs.put(nextJob)]);
        return publicJob(nextJob);
      },
    );
  }

  async cancelJob(
    jobId: string,
    expectedScanRevisionInput: number,
    expectedReviewRevisionInput: number,
    updatedAtInput?: string,
    guard: ScanTransactionGuard = {},
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const expectedReviewRevision = assertRevision(
      expectedReviewRevisionInput,
      'expectedReviewRevision',
    );
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        const value = await jobs.get(id);
        if (value === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
        const isPausedScan =
          current.status === 'paused' && current.stopRecord?.phase === 'scanning';
        if (
          current.status !== 'prepared' &&
          current.status !== 'scanning' &&
          current.status !== 'ready_for_review' &&
          !isPausedScan
        ) {
          throw new SyncStoreConflictError('Only pre-write jobs can be cancelled');
        }
        if (current.status === 'scanning' && guard.beforeCommit === undefined) {
          throw new SyncStoreConflictError('A scanning cancellation requires the invocation guard');
        }
        if (
          current.scanRevision !== expectedScanRevision ||
          current.reviewRevision !== expectedReviewRevision
        ) {
          throw new SyncStoreConflictError('Cancellation revision is stale');
        }
        if (
          current.writeAuthorizedAt !== undefined ||
          current.authorizedReviewRevision !== undefined ||
          Date.parse(updatedAt) < Date.parse(current.updatedAt)
        ) {
          throw new SyncStoreConflictError('Pre-write cancellation state is unsafe');
        }
        const [unresolvedIntents, itemValues] = await Promise.all([
          intents.index('by-job-id').count(id),
          items.index('by-job-id').getAll(id, MAX_LIST_RESULTS),
        ]);
        const itemRows = itemValues.map((itemValue, index) =>
          parsePersistedRow(SyncJobItemRowSchema, itemValue, 'items', index),
        );
        if (
          unresolvedIntents !== 0 ||
          itemRows.some(
            (item) => item.writeStatus !== 'not_requested' || item.outcome !== undefined,
          )
        ) {
          throw new SyncStoreConflictError('Pre-write cancellation found write protocol state');
        }
        const next = rowWithStatus(current, 'cancelled', updatedAt);
        await jobs.put(next);
        return publicJob(next);
      },
      guard,
    );
  }

  async abandonWriteJob(
    jobId: string,
    expectedScanRevisionInput: number,
    expectedReviewRevisionInput: number,
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const expectedReviewRevision = assertRevision(
      expectedReviewRevisionInput,
      'expectedReviewRevision',
    );
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());
    return writeTransaction(
      this.database,
      ['jobs', 'items', 'intents'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        const value = await jobs.get(id);
        if (value === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const current = parsePersistedRow(SyncJobRowSchema, value, 'jobs', id);
        const isPausedWrite =
          current.status === 'paused' && current.stopRecord?.phase === 'writing';
        if (current.status !== 'writing' && current.status !== 'partial' && !isPausedWrite) {
          throw new SyncStoreConflictError('The job is not in a reconcilable write state');
        }
        if (
          current.scanRevision !== expectedScanRevision ||
          current.reviewRevision !== expectedReviewRevision ||
          current.writeAuthorizedAt === undefined ||
          current.authorizedReviewRevision !== current.reviewRevision ||
          Date.parse(updatedAt) < Date.parse(current.updatedAt)
        ) {
          throw new SyncStoreConflictError('Write abandonment revision or authorization is stale');
        }
        const [unresolvedIntents, pendingWrites] = await Promise.all([
          intents.index('by-job-id').count(id),
          items.index('by-job-write-status').count([id, 'pending']),
        ]);
        if (
          unresolvedIntents !== 0 ||
          pendingWrites !== 0 ||
          current.summary.writePendingCount !== 0
        ) {
          throw new SyncStoreConflictError('Write intents must be reconciled before abandonment');
        }
        const next = rowWithStatus(current, 'cancelled', updatedAt);
        await jobs.put(next);
        return publicJob(next);
      },
    );
  }

  async authorizeReviewSelection(
    jobId: string,
    expectedReviewRevisionInput: number,
    selectedSourceItemIdsInput: readonly string[],
    updatedAtInput?: string,
  ): Promise<SyncJob> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedReviewRevision = assertRevision(
      expectedReviewRevisionInput,
      'expectedReviewRevision',
    );
    const selectedSourceItemIds = parseSelectedSourceItemIds(selectedSourceItemIdsInput);
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(this.database, ['jobs', 'items'] as const, async (transaction) => {
      const jobs = transaction.objectStore('jobs');
      const items = transaction.objectStore('items');
      const jobValue = await jobs.get(id);
      if (jobValue === undefined) {
        throw new SyncStoreNotFoundError('job');
      }
      const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
      const resumableWritePause = job.status === 'paused' && job.stopRecord?.phase === 'writing';
      if (job.status !== 'ready_for_review' && job.status !== 'partial' && !resumableWritePause) {
        throw new SyncStoreConflictError('The job is not ready for write authorization');
      }
      if (job.reviewRevision !== expectedReviewRevision || expectedReviewRevision < 1) {
        throw new SyncStoreConflictError('Review revision is stale or unreviewed');
      }
      if (
        Date.parse(updatedAt) < Date.parse(job.updatedAt) ||
        ((job.status === 'partial' || resumableWritePause) &&
          Date.parse(updatedAt) <= Date.parse(job.updatedAt))
      ) {
        throw new SyncStoreConflictError('Write authorization must be newer than persisted state');
      }
      const values = await items.index('by-job-id').getAll(id, MAX_LIST_RESULTS);
      const rows = values.map((value, index) =>
        parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
      );
      if (rows.length !== job.summary.uniqueItemCount || job.summary.unreviewedCount !== 0) {
        throw new SyncStoreConflictError('Review decisions do not cover every job item');
      }
      const persistedSelected = rows
        .filter((row) => row.reviewDecision === 'selected')
        .map((row) => row.sourceItemId)
        .sort();
      const persistedExcludedCount = rows.filter((row) => row.reviewDecision === 'excluded').length;
      if (
        persistedSelected.length !== job.summary.selectedCount ||
        persistedExcludedCount !== job.summary.excludedCount
      ) {
        throw new CorruptSyncRowError(
          'jobs',
          id,
          new Error('Review decision counts differ from persisted items'),
        );
      }
      if (JSON.stringify(persistedSelected) !== JSON.stringify(selectedSourceItemIds)) {
        throw new SyncStoreConflictError(
          'Authorized IDs differ from the persisted review selection',
        );
      }
      for (const row of rows) {
        if (row.reviewRevision !== job.reviewRevision) {
          throw new SyncStoreConflictError('Item review revision differs from the job revision');
        }
        if (row.reviewDecision === 'selected' && !isReviewEligible(row)) {
          throw new SyncStoreConflictError('An ineligible item cannot be authorized for writing');
        }
      }
      const candidate: Record<string, unknown> = {
        ...job,
        status: 'writing',
        authorizedReviewRevision: job.reviewRevision,
        writeAuthorizedAt: updatedAt,
        updatedAt,
        activeSource: job.source,
      };
      delete candidate.stopRecord;
      const next = SyncJobRowSchema.parse(candidate);
      await jobs.put(next);
      return publicJob(next);
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
    if (
      [
        'scanning',
        'paused',
        'ready_for_review',
        'writing',
        'complete_with_issues',
        'cancelled',
      ].includes(nextStatus)
    ) {
      throw new SyncStoreConflictError(
        'Scanning, pausing, review completion, cancellation, and write authorization require dedicated methods',
      );
    }

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
        if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
          throw new SyncStoreConflictError('Job timestamps must be monotonic');
        }
        const items = transaction.objectStore('items');
        const intents = transaction.objectStore('intents');
        if (nextStatus === 'partial') {
          const [unresolvedIntents, itemValues] = await Promise.all([
            intents.index('by-job-id').count(id),
            items.index('by-job-id').getAll(id, MAX_LIST_RESULTS),
          ]);
          const itemRows = itemValues.map((value, index) =>
            parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
          );
          const decisionsAreSettled = itemRows.every((item) =>
            item.reviewDecision === 'excluded'
              ? item.writeStatus === 'not_requested'
              : item.reviewDecision === 'selected' &&
                ['created', 'already_exists', 'skipped', 'error'].includes(item.writeStatus),
          );
          if (
            current.summary.classificationErrorCount + current.summary.writeErrorCount === 0 ||
            current.summary.writePendingCount !== 0 ||
            current.summary.unreviewedCount !== 0 ||
            unresolvedIntents !== 0 ||
            !decisionsAreSettled
          ) {
            throw new SyncStoreConflictError(
              'A job can enter partial only after its write pass settles with errors',
            );
          }
        } else if (nextStatus === 'complete') {
          const counts = await Promise.all([
            items.index('by-job-classification').count([id, 'pending']),
            items.index('by-job-classification').count([id, 'error']),
            items.index('by-job-write-status').count([id, 'pending']),
            items.index('by-job-write-status').count([id, 'error']),
            intents.index('by-job-id').count(id),
          ]);
          const itemValues = await items.index('by-job-id').getAll(id, MAX_LIST_RESULTS);
          const itemRows = itemValues.map((value, index) =>
            parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
          );
          const decisionsAreSettled = itemRows.every((item) =>
            item.reviewDecision === 'excluded'
              ? item.writeStatus === 'not_requested'
              : item.reviewDecision === 'selected' &&
                ['created', 'already_exists', 'skipped'].includes(item.writeStatus),
          );
          if (
            counts.some((count) => count !== 0) ||
            !decisionsAreSettled ||
            current.summary.unreviewedCount !== 0
          ) {
            throw new SyncStoreConflictError(
              'A job cannot complete with unsettled review decisions, errors, or write intents',
            );
          }
        } else if (nextStatus === 'failed') {
          const [unresolvedIntents, pendingItems] = await Promise.all([
            intents.index('by-job-id').count(id),
            items.index('by-job-write-status').count([id, 'pending']),
          ]);
          if (unresolvedIntents !== 0 || pendingItems !== 0) {
            throw new SyncStoreConflictError(
              'A terminal job cannot retain unresolved write protocol state',
            );
          }
        }

        const next = rowWithStatus(current, nextStatus, updatedAt);
        await jobs.put(next);
        return publicJob(next);
      },
    );
  }

  async classifyAndPersistScanBatch(
    jobId: string,
    expectedScanRevisionInput: number,
    observationInputs: readonly unknown[],
    observedNodeDeltaInput: number,
    updatedAtInput?: string,
    guard: ScanTransactionGuard = {},
  ): Promise<ClassifyAndPersistScanBatchResult> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const rawObservations = readBoundedPlainArray(
      observationInputs,
      MAX_OBSERVED_NODES_PER_INVOCATION,
      'Scan observations',
    );
    let batchBytes = 0;
    const observations = rawObservations.map((input) => {
      const item = SocialItemSchema.parse(input);
      const bytes = encoder.encode(JSON.stringify(item)).byteLength;
      batchBytes += bytes;
      if (batchBytes > MAX_TRANSACTION_INPUT_BYTES) {
        throw new RangeError('Scan observations exceed the transaction byte limit');
      }
      return { item, bytes };
    });
    if (
      !Number.isSafeInteger(observedNodeDeltaInput) ||
      observedNodeDeltaInput < observations.length ||
      observedNodeDeltaInput > MAX_OBSERVED_NODES_PER_INVOCATION
    ) {
      throw new RangeError('observedNodeDelta must cover observations and remain within 200');
    }
    const observedIds = observations.map(({ item }) => item.sourceItemId);
    if (new Set(observedIds).size !== observedIds.length) {
      throw new SyncStoreConflictError('Scan observations contain duplicate source item IDs');
    }
    const updatedAt = IsoTimestampSchema.parse(updatedAtInput ?? this.now());

    return writeTransaction(
      this.database,
      ['jobs', 'items', 'records'] as const,
      async (transaction) => {
        const jobs = transaction.objectStore('jobs');
        const items = transaction.objectStore('items');
        const records = transaction.objectStore('records');
        const jobValue = await jobs.get(id);
        if (jobValue === undefined) {
          throw new SyncStoreNotFoundError('job');
        }
        const job = parsePersistedRow(SyncJobRowSchema, jobValue, 'jobs', id);
        if (
          job.status !== 'scanning' ||
          job.scanRevision !== expectedScanRevision ||
          job.scanCompletion !== undefined
        ) {
          throw new SyncStoreConflictError('Only the current scanning worker may persist a batch');
        }
        if (Date.parse(updatedAt) < Date.parse(job.updatedAt)) {
          throw new SyncStoreConflictError('Scan timestamps must be monotonic');
        }

        const existingValues = await items.index('by-job-id').getAll(id, MAX_LIST_RESULTS);
        const existingRows = existingValues.map((value, index) =>
          parsePersistedRow(SyncJobItemRowSchema, value, 'items', index),
        );
        if (existingRows.length !== job.summary.uniqueItemCount) {
          throw new CorruptSyncRowError(
            'jobs',
            id,
            new Error('Persisted item count differs from the job summary'),
          );
        }
        const rowsBySourceItemId = new Map(existingRows.map((row) => [row.sourceItemId, row]));
        if (rowsBySourceItemId.size !== existingRows.length) {
          throw new CorruptSyncRowError(
            'items',
            id,
            new Error('Persisted job items contain duplicate source identities'),
          );
        }
        let candidateCount = existingRows.filter((row) =>
          ['new', 'changed', 'incomplete', 'error'].includes(row.classification),
        ).length;
        let classificationErrorCount = existingRows.filter(
          (row) => row.classification === 'error',
        ).length;
        const legacyExistingRows = existingRows.filter(
          (row) => row.classification === 'existing',
        ).length;
        const previousCheckpoint = job.checkpoint;
        if (
          (previousCheckpoint?.candidateCount ?? 0) !== candidateCount ||
          (previousCheckpoint?.classificationErrorCount ?? 0) !== classificationErrorCount ||
          (previousCheckpoint?.catalogExistingObservationCount ?? 0) < legacyExistingRows ||
          job.summary.classificationErrorCount !== classificationErrorCount
        ) {
          throw new CorruptSyncRowError(
            'jobs',
            id,
            new Error('Persisted scan counters differ from job item rows'),
          );
        }

        const classify = async (
          item: SocialItem,
        ): Promise<Exclude<SyncItemClassification, 'pending'>> => {
          const recordKey = makeSyncRecordKey(item.source, item.sourceItemId);
          const keyValue = await records.get(recordKey);
          if (keyValue !== undefined) {
            const record = parsePersistedRow(SyncRecordSchema, keyValue, 'records', recordKey);
            return itemMatchesCatalogIdentity(item, record) ? 'existing' : 'changed';
          }
          const [canonicalValues, hashValues] = await Promise.all([
            records.index('by-canonical-url').getAll(item.canonicalUrl, 2),
            records.index('by-content-hash').getAll(item.contentHash, 2),
          ]);
          const canonicalMatches = canonicalValues.map((value, index) =>
            parsePersistedRow(SyncRecordSchema, value, 'records', `canonical-${index}`),
          );
          const hashMatches = hashValues.map((value, index) =>
            parsePersistedRow(SyncRecordSchema, value, 'records', `hash-${index}`),
          );
          if (canonicalMatches.length > 1 || hashMatches.length > 1) {
            return 'error';
          }
          const canonicalMatch = canonicalMatches[0];
          const hashMatch = hashMatches[0];
          if (
            canonicalMatch?.key === recordKey ||
            hashMatch?.key === recordKey ||
            (canonicalMatch && hashMatch && canonicalMatch.key !== hashMatch.key)
          ) {
            return 'error';
          }
          if (canonicalMatch || hashMatch) {
            return 'incomplete';
          }
          return item.completeness === 'complete' || item.completeness === 'summary_only'
            ? 'new'
            : 'incomplete';
        };

        let insertedCandidates = 0;
        let replayedCandidates = 0;
        let catalogExistingObservations = 0;
        let pendingReviewCount = job.summary.pendingReviewCount;
        let unreviewedCount = job.summary.unreviewedCount;
        let knownFrontierSourceItemIds = [
          ...(previousCheckpoint?.knownFrontierSourceItemIds ?? []),
        ];
        let consecutiveKnownIds =
          previousCheckpoint?.knownFrontierSourceItemIds === undefined
            ? 0
            : (previousCheckpoint.consecutiveKnownIds ?? 0);
        const classifications: ClassifyAndPersistScanBatchResult['classifications'] = [];
        const rowsToWrite: SyncJobItemRow[] = [];

        for (const { item, bytes } of observations) {
          if (item.source !== job.source) {
            throw new SyncStoreConflictError('SocialItem source does not match the job source');
          }
          if (item.media.length > job.budgets.maxMediaPerItem || bytes > job.budgets.maxItemBytes) {
            throw new SyncStoreConflictError('SocialItem exceeds the persisted job budget');
          }
          const replay = rowsBySourceItemId.get(item.sourceItemId);
          if (replay) {
            if (!sameStableSocialItem(replay.item, item)) {
              throw new SyncStoreConflictError(
                'A replayed source item conflicts with the persisted job item',
              );
            }
            let classification = replay.classification;
            if (classification === 'pending') {
              classification = await classify(item);
              pendingReviewCount -= 1;
              if (classification === 'existing') {
                catalogExistingObservations += 1;
              } else {
                candidateCount += 1;
                classificationErrorCount += classification === 'error' ? 1 : 0;
              }
              const classifiedReplay = SyncJobItemRowSchema.parse({
                ...replay,
                classification,
                updatedAt,
              });
              rowsToWrite.push(classifiedReplay);
              rowsBySourceItemId.set(item.sourceItemId, classifiedReplay);
            }
            replayedCandidates += 1;
            consecutiveKnownIds = 0;
            knownFrontierSourceItemIds = [];
            classifications.push({ sourceItemId: item.sourceItemId, classification });
            continue;
          }

          const classification = await classify(item);
          classifications.push({ sourceItemId: item.sourceItemId, classification });
          if (classification === 'existing') {
            catalogExistingObservations += 1;
            if (!knownFrontierSourceItemIds.includes(item.sourceItemId)) {
              if (knownFrontierSourceItemIds.length < SYNC_KNOWN_FRONTIER_LIMIT) {
                knownFrontierSourceItemIds.push(item.sourceItemId);
              }
              consecutiveKnownIds = knownFrontierSourceItemIds.length;
            }
            continue;
          }
          candidateCount += 1;
          classificationErrorCount += classification === 'error' ? 1 : 0;
          insertedCandidates += 1;
          unreviewedCount += 1;
          consecutiveKnownIds = 0;
          knownFrontierSourceItemIds = [];
          const row = SyncJobItemRowSchema.parse({
            key: makeSyncJobItemKey(id, item.sourceItemId),
            schemaVersion: SYNC_SCHEMA_VERSION,
            jobId: id,
            sourceItemId: item.sourceItemId,
            item,
            classification,
            reviewDecision: 'unreviewed',
            reviewRevision: 0,
            writeStatus: 'not_requested',
            discoveredAt: updatedAt,
            updatedAt,
          });
          rowsToWrite.push(row);
          rowsBySourceItemId.set(item.sourceItemId, row);
        }

        const scannedCount = (previousCheckpoint?.scannedCount ?? 0) + observations.length;
        const acceptedCount = (previousCheckpoint?.acceptedCount ?? 0) + observations.length;
        const acceptedBytes = (previousCheckpoint?.acceptedBytes ?? 0) + batchBytes;
        const catalogExistingObservationCount =
          (previousCheckpoint?.catalogExistingObservationCount ?? 0) + catalogExistingObservations;
        if (
          candidateCount > job.budgets.maxItems ||
          acceptedBytes > SYNC_LIMITS.maxAcceptedBytesPerJob ||
          scannedCount > 1_000_000 ||
          acceptedCount > 1_000_000 ||
          candidateCount !==
            [...rowsBySourceItemId.values()].filter((row) =>
              ['new', 'changed', 'incomplete', 'error'].includes(row.classification),
            ).length ||
          classificationErrorCount !==
            [...rowsBySourceItemId.values()].filter((row) => row.classification === 'error').length
        ) {
          throw new SyncStoreConflictError('The scan batch would violate a persisted budget');
        }
        const checkpoint = SyncCheckpointSchema.parse({
          schemaVersion: SYNC_SCHEMA_VERSION,
          contractVersion: SYNC_JOB_CONTRACT_VERSION,
          adapterVersion: job.adapterVersion,
          scanRevision: job.scanRevision,
          scannedCount,
          acceptedCount,
          acceptedBytes,
          candidateCount,
          classificationErrorCount,
          catalogExistingObservationCount,
          consecutiveKnownIds,
          knownFrontierSourceItemIds,
          ...(previousCheckpoint?.cursor === undefined
            ? {}
            : { cursor: previousCheckpoint.cursor }),
          updatedAt,
        });
        const nextJob = SyncJobRowSchema.parse({
          ...job,
          updatedAt,
          checkpoint,
          summary: {
            ...job.summary,
            scannedCount,
            uniqueItemCount: rowsBySourceItemId.size,
            pendingReviewCount,
            classificationErrorCount,
            unreviewedCount,
          },
        });
        await Promise.all([...rowsToWrite.map((row) => items.put(row)), jobs.put(nextJob)]);
        return {
          insertedCandidates,
          replayedCandidates,
          catalogExistingObservations,
          classifications,
          job: publicJob(nextJob),
        };
      },
      guard,
    );
  }

  async putScanBatch(
    jobId: string,
    expectedScanRevisionInput: number,
    itemInputs: readonly unknown[],
    checkpointInput: unknown,
  ): Promise<PutScanBatchResult> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
    const rawItems = readBoundedPlainArray(itemInputs, SYNC_LIMITS.maxItemsPerJob, 'Scan batch');
    let batchBytes = 0;
    const items = rawItems.map((item) => {
      const parsed = SocialItemSchema.parse(item);
      const bytes = encoder.encode(JSON.stringify(parsed)).byteLength;
      batchBytes += bytes;
      if (batchBytes > MAX_TRANSACTION_INPUT_BYTES) {
        throw new RangeError('Scan batch exceeds the transaction byte limit');
      }
      return { item: parsed, bytes };
    });
    const requestedCheckpoint = parseOperationCheckpoint(checkpointInput);

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
      if (
        job.scanRevision !== expectedScanRevision ||
        requestedCheckpoint.scanRevision !== expectedScanRevision
      ) {
        throw new SyncStoreConflictError('Scan revision is stale');
      }
      if (requestedCheckpoint.adapterVersion !== job.adapterVersion) {
        throw new SyncStoreConflictError('Checkpoint adapterVersion does not match the job');
      }
      if (
        Date.parse(requestedCheckpoint.updatedAt) < Date.parse(job.updatedAt) ||
        requestedCheckpoint.scannedCount < job.summary.scannedCount ||
        requestedCheckpoint.acceptedCount < (job.checkpoint?.acceptedCount ?? 0)
      ) {
        throw new SyncStoreConflictError('Checkpoint progress must be monotonic');
      }

      let inserted = 0;
      let existing = 0;
      let insertedBytes = 0;
      for (const { item, bytes } of items) {
        if (item.source !== job.source) {
          throw new SyncStoreConflictError('SocialItem source does not match the job source');
        }
        if (item.media.length > job.budgets.maxMediaPerItem) {
          throw new SyncStoreConflictError('SocialItem exceeds the job media budget');
        }
        if (bytes > job.budgets.maxItemBytes) {
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
          reviewDecision: 'unreviewed',
          reviewRevision: 0,
          writeStatus: 'not_requested',
          discoveredAt: requestedCheckpoint.updatedAt,
          updatedAt: requestedCheckpoint.updatedAt,
        });
        await itemStore.add(row);
        inserted += 1;
        insertedBytes += bytes;
      }

      const uniqueItemCount = job.summary.uniqueItemCount + inserted;
      if (
        uniqueItemCount > job.budgets.maxItems ||
        requestedCheckpoint.acceptedCount < uniqueItemCount ||
        requestedCheckpoint.scannedCount < uniqueItemCount
      ) {
        throw new SyncStoreConflictError('Checkpoint counts do not cover persisted unique items');
      }
      if (
        requestedCheckpoint.acceptedBytes <
        (job.checkpoint?.acceptedBytes ?? 0) + insertedBytes
      ) {
        throw new SyncStoreConflictError(
          'Checkpoint accepted bytes must cover newly persisted unique items',
        );
      }
      const checkpoint = SyncCheckpointSchema.parse({
        ...requestedCheckpoint,
        contractVersion: SYNC_JOB_CONTRACT_VERSION,
        candidateCount: job.checkpoint?.candidateCount ?? 0,
        classificationErrorCount: job.summary.classificationErrorCount,
        catalogExistingObservationCount: job.checkpoint?.catalogExistingObservationCount ?? 0,
        consecutiveKnownIds: 0,
        knownFrontierSourceItemIds: [],
      });
      const nextJob = SyncJobRowSchema.parse({
        ...job,
        updatedAt: requestedCheckpoint.updatedAt,
        checkpoint,
        summary: {
          ...job.summary,
          scannedCount: checkpoint.scannedCount,
          uniqueItemCount,
          pendingReviewCount: job.summary.pendingReviewCount + inserted,
          unreviewedCount: job.summary.unreviewedCount + inserted,
        },
      });
      await jobs.put(nextJob);
      return { inserted, existing, job: publicJob(nextJob) };
    });
  }

  async putJobItem(
    jobId: string,
    expectedScanRevision: number,
    itemInput: unknown,
    checkpointInput: unknown,
  ): Promise<PutJobItemResult> {
    const item = SocialItemSchema.parse(itemInput);
    const result = await this.putScanBatch(jobId, expectedScanRevision, [item], checkpointInput);
    const stored = await this.getJobItem(jobId, item.sourceItemId);
    if (!stored) {
      throw new SyncStoreError(
        'transaction_failed',
        'Committed job item could not be read back from IndexedDB',
      );
    }
    return { inserted: result.inserted === 1, item: stored, job: result.job };
  }

  async putCheckpoint(
    jobId: string,
    expectedScanRevision: number,
    checkpointInput: unknown,
  ): Promise<SyncJob> {
    return (await this.putScanBatch(jobId, expectedScanRevision, [], checkpointInput)).job;
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
    expectedScanRevisionInput: number,
    updatedAtInput?: string,
  ): Promise<SyncJobItem> {
    this.assertOpen();
    const id = SyncJobIdSchema.parse(jobId);
    const sourceItemId = SourceItemIdSchema.parse(sourceItemIdInput);
    const classification = SyncItemClassificationSchema.parse(classificationInput);
    const expectedScanRevision = assertRevision(expectedScanRevisionInput, 'expectedScanRevision');
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
      if (job.scanRevision !== expectedScanRevision) {
        throw new SyncStoreConflictError('Scan revision is stale');
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
      if (!job.checkpoint) {
        throw new CorruptSyncRowError(
          'jobs',
          id,
          new Error('A persisted item classification requires a checkpoint'),
        );
      }
      const checkpoint = SyncCheckpointSchema.parse({
        ...job.checkpoint,
        candidateCount: job.checkpoint.candidateCount + (classification === 'existing' ? 0 : 1),
        classificationErrorCount:
          job.checkpoint.classificationErrorCount + (classification === 'error' ? 1 : 0),
        catalogExistingObservationCount:
          job.checkpoint.catalogExistingObservationCount + (classification === 'existing' ? 1 : 0),
        consecutiveKnownIds: 0,
        knownFrontierSourceItemIds: [],
        updatedAt,
      });
      const nextJob = SyncJobRowSchema.parse({
        ...job,
        updatedAt,
        checkpoint,
        summary: {
          ...job.summary,
          pendingReviewCount: job.summary.pendingReviewCount - 1,
          classificationErrorCount:
            job.summary.classificationErrorCount + (classification === 'error' ? 1 : 0),
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
    const rawRecords = readBoundedPlainArray(
      recordInputs,
      SYNC_LIMITS.maxCatalogBatch,
      'Catalog batch',
    );
    let batchBytes = 0;
    const records = rawRecords.map((record) => {
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
    const reviewRevision = assertRevision(input.reviewRevision, 'reviewRevision');
    if (reviewRevision < 1) {
      throw new RangeError('reviewRevision must be positive');
    }
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
        if (
          job.authorizedReviewRevision !== reviewRevision ||
          job.reviewRevision !== reviewRevision ||
          item.reviewDecision !== 'selected' ||
          item.reviewRevision !== reviewRevision ||
          !isReviewEligible(item)
        ) {
          throw new SyncStoreConflictError(
            'Write intent is not covered by the persisted review authorization',
          );
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
          reviewRevision,
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
        if (retryingError && job.summary.writeErrorCount < 1) {
          throw new CorruptSyncRowError(
            'jobs',
            job.id,
            new Error('writeErrorCount is inconsistent with the retried item'),
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
            writeErrorCount: job.summary.writeErrorCount - (retryingError ? 1 : 0),
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
        if (
          job.source !== intent.source ||
          job.authorizedReviewRevision !== intent.reviewRevision ||
          job.reviewRevision !== intent.reviewRevision ||
          item.reviewDecision !== 'selected' ||
          item.reviewRevision !== intent.reviewRevision ||
          !intentMatchesJobItem(intent, item)
        ) {
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
          writeErrorCount: job.summary.writeErrorCount + (outcome.status === 'error' ? 1 : 0),
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
  let upgraded = false;
  try {
    const opened = await openRawDatabase(factory, dbName, options.onBlocked);
    rawDatabase = opened.database;
    upgraded = opened.upgradedFrom !== undefined;
    if (upgraded) {
      rawDatabase.close();
      rawDatabase = undefined;
      const reopened = await openRawDatabase(factory, dbName, options.onBlocked);
      if (reopened.upgradedFrom !== undefined) {
        reopened.database.close();
        throw new SyncStoreMigrationError(
          'DB3_REOPEN_VALIDATION_FAILED',
          'DB3 unexpectedly attempted another upgrade during reopen validation',
        );
      }
      rawDatabase = reopened.database;
    }
    assertDatabaseLayout(rawDatabase);
  } catch (error) {
    rawDatabase?.close();
    if (
      upgraded &&
      !(error instanceof SyncStoreMigrationError && error.code === 'DB3_REOPEN_VALIDATION_FAILED')
    ) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 layout validation failed after the upgrade committed',
        { cause: error },
      );
    }
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
    if (upgraded) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 could not be wrapped after the upgrade committed',
        { cause: error },
      );
    }
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
    await validateSyncDatabaseOnOpen(database, upgraded);
  } catch (error) {
    store.close();
    if (upgraded) {
      throw new SyncStoreMigrationError(
        'DB3_REOPEN_VALIDATION_FAILED',
        'DB3 metadata validation failed after the upgrade committed',
        { cause: error },
      );
    }
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
