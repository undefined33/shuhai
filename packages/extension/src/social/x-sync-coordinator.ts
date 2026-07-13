import {
  IsoTimestampSchema,
  SocialItemSchema,
  SyncJobItemSchema,
  SyncJobSchema,
  SyncRecordSchema,
  SyncJobIdSchema,
  SYNC_LIMITS,
  makeSyncRecordKey,
  type SocialItem,
  type SyncCheckpoint,
  type SyncItemClassification,
  type SyncJob,
  type SyncJobItem,
  type SyncRecord,
  type SyncStopReason,
} from './sync-schema.js';
import {
  X_BOOKMARKS_ADAPTER_VERSION,
  X_BOOKMARKS_CEILINGS,
  resolveXBookmarksLimits,
  type XBookmarksLimits,
} from './adapters/x-bookmarks.js';
import type {
  AdapterBatchResult,
  AdapterBudget,
  AdapterCapability,
  AdapterChallenge,
  AdapterSignal,
} from './adapters/types.js';

const textEncoder = new TextEncoder();
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_REVISION = 1_000_000;
const INVOCATION_DEADLINE_EXCEEDED = Symbol('invocation-deadline-exceeded');
const X_CANONICAL_PERMALINK_PATTERN =
  /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,19})$/u;

export interface AdapterBatchRequest {
  readonly source: 'x';
  readonly adapterVersion: number;
  readonly scanRevision: number;
  readonly step: number;
  readonly jobAcceptedItems: number;
  readonly jobAcceptedBytes: number;
  readonly invocationObservedNodes: number;
  readonly invocationElapsedMs: number;
  readonly limits: Readonly<XBookmarksLimits>;
}

/**
 * The future 043B bridge may implement this port. Its return value remains untrusted even when the
 * implementation is typed, so the coordinator parses it again before touching persistent state.
 */
export interface AdapterBatchPort {
  readBatch(request: AdapterBatchRequest): Promise<unknown>;
}

export interface SyncCatalogLookupPort {
  getRecordByKey(recordKey: string): Promise<unknown>;
  getRecordByCanonicalUrl(canonicalUrl: string): Promise<unknown>;
  getRecordByContentHash(contentHash: string): Promise<unknown>;
}

export interface XSyncCoordinatorStorePort {
  createJob(input: {
    id: string;
    source: 'x';
    adapterVersion: number;
    budgets: {
      maxItems: number;
      maxPages: number;
      maxDurationMs: number;
      maxItemBytes: number;
      maxMediaPerItem: number;
    };
    createdAt?: string;
  }): Promise<SyncJob>;
  getJob(jobId: string): Promise<SyncJob | undefined>;
  claimScanRevision(
    jobId: string,
    expectedScanRevision: number,
    updatedAt?: string,
  ): Promise<SyncJob>;
  pauseJobWithStopRecord(
    jobId: string,
    expectedScanRevision: number,
    reason: SyncStopReason,
    phase: 'scanning' | 'writing',
    updatedAt?: string,
  ): Promise<SyncJob>;
  finishScan(
    jobId: string,
    expectedScanRevision: number,
    updatedAt?: string,
    guard?: {
      readonly signal?: AbortSignal;
      readonly beforeCommit?: () => boolean;
    },
  ): Promise<SyncJob>;
  listJobItems(jobId: string, options?: { limit?: number }): Promise<SyncJobItem[]>;
  putScanBatch(
    jobId: string,
    expectedScanRevision: number,
    items: readonly unknown[],
    checkpoint: unknown,
  ): Promise<{ inserted: number; existing: number; job: SyncJob }>;
  updateJobItemClassification(
    jobId: string,
    sourceItemId: string,
    classification: SyncItemClassification,
    expectedScanRevision: number,
    updatedAt?: string,
  ): Promise<SyncJobItem>;
}

export interface XSyncCoordinatorOptions {
  readonly now?: () => number;
  readonly nowIso?: () => string;
}

export interface CreateAndStartXSyncInput {
  readonly jobId: string;
  readonly limits?: unknown;
  readonly createdAt?: string;
}

export interface StartOrResumeXSyncInput {
  readonly jobId: string;
  readonly expectedScanRevision: number;
  readonly limits?: unknown;
}

export interface PauseXSyncInput {
  readonly jobId: string;
  readonly expectedScanRevision: number;
}

export interface XSyncInvocationMetrics {
  readonly steps: number;
  readonly observedNodes: number;
  readonly elapsedMs: number;
  readonly insertedItems: number;
  readonly replayedItems: number;
}

export type XSyncInvocationResult =
  | {
      readonly outcome: 'ready_for_review';
      readonly job: SyncJob;
      readonly metrics: XSyncInvocationMetrics;
    }
  | {
      readonly outcome: 'paused';
      readonly stopReason: SyncStopReason;
      readonly job: SyncJob;
      readonly metrics: XSyncInvocationMetrics;
    };

export type XSyncCoordinatorErrorCode = 'invalid_clock' | 'invalid_state' | 'invalid_store_state';

export class XSyncCoordinatorError extends Error {
  readonly code: XSyncCoordinatorErrorCode;

  constructor(code: XSyncCoordinatorErrorCode, message: string) {
    super(message);
    this.name = 'XSyncCoordinatorError';
    this.code = code;
  }
}

interface InvocationProgress {
  steps: number;
  observedNodes: number;
  reportedElapsedMs: number;
  insertedItems: number;
  replayedItems: number;
}

interface ParsedBatch {
  readonly result: AdapterBatchResult;
  readonly itemBytes: readonly number[];
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function inspectStrictRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }

  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedKeys.has(key) || FORBIDDEN_OBJECT_KEYS.has(key)) {
      return null;
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return null;
    }
    output[key] = descriptor.value;
  }
  return output;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function inspectPlainArray(value: unknown, maximum: number): readonly unknown[] | null {
  let isArray: boolean;
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = isArray ? Object.getPrototypeOf(value) : null;
    descriptors = isArray ? Object.getOwnPropertyDescriptors(value) : {};
  } catch {
    return null;
  }
  if (!isArray || prototype !== Array.prototype) {
    return null;
  }
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximum
  ) {
    return null;
  }
  const length = lengthDescriptor.value as number;
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== length) {
    return null;
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return null;
    }
    output.push(descriptor.value);
  }
  return output;
}

function nonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : null;
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = nonNegativeInteger(value, maximum);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseCapability(value: unknown): AdapterCapability | null {
  const record = inspectStrictRecord(value, new Set(['kind', 'source', 'adapterVersion']));
  if (!record || typeof ownValue(record, 'kind') !== 'string') {
    return null;
  }
  if (record.kind === 'unsupported') {
    return hasExactKeys(record, ['kind']) ? { kind: 'unsupported' } : null;
  }
  const adapterVersion = positiveInteger(record.adapterVersion, MAX_REVISION);
  if (
    record.kind !== 'collection_scan' ||
    record.source !== 'x' ||
    adapterVersion === null ||
    !hasExactKeys(record, ['adapterVersion', 'kind', 'source'])
  ) {
    return null;
  }
  return { kind: 'collection_scan', source: 'x', adapterVersion };
}

function parseSignal(value: unknown): AdapterSignal | null {
  const record = inspectStrictRecord(value, new Set(['kind', 'challenge', 'stopReason', 'budget']));
  if (!record || typeof record.kind !== 'string') {
    return null;
  }
  if (['items', 'empty', 'terminal', 'unsupported'].includes(record.kind)) {
    return hasExactKeys(record, ['kind']) ? ({ kind: record.kind } as AdapterSignal) : null;
  }
  if (record.kind === 'structure_changed') {
    return record.stopReason === 'structure_changed' && hasExactKeys(record, ['kind', 'stopReason'])
      ? { kind: 'structure_changed', stopReason: 'structure_changed' }
      : null;
  }
  if (record.kind === 'challenge') {
    const challenge = record.challenge as AdapterChallenge;
    const validChallenge = ['login_required', 'captcha', 'rate_limited'].includes(challenge);
    const expectedReason = challenge === 'rate_limited' ? 'rate_limited' : 'login_required';
    return validChallenge &&
      record.stopReason === expectedReason &&
      hasExactKeys(record, ['challenge', 'kind', 'stopReason'])
      ? { kind: 'challenge', challenge, stopReason: expectedReason }
      : null;
  }
  if (record.kind === 'budget_exceeded') {
    const budget = record.budget as AdapterBudget;
    return ['accepted_items', 'accepted_bytes', 'elapsed_time', 'observed_nodes'].includes(
      budget,
    ) &&
      record.stopReason === 'budget_exceeded' &&
      hasExactKeys(record, ['budget', 'kind', 'stopReason'])
      ? { kind: 'budget_exceeded', budget, stopReason: 'budget_exceeded' }
      : null;
  }
  return null;
}

function parseMetrics(value: unknown): AdapterBatchResult['metrics'] | null {
  const record = inspectStrictRecord(
    value,
    new Set(['observedNodes', 'acceptedItems', 'acceptedBytes', 'elapsedMs']),
  );
  if (
    !record ||
    !hasExactKeys(record, ['acceptedBytes', 'acceptedItems', 'elapsedMs', 'observedNodes'])
  ) {
    return null;
  }
  const observedNodes = nonNegativeInteger(
    record.observedNodes,
    X_BOOKMARKS_CEILINGS.maxObservedNodes,
  );
  const acceptedItems = nonNegativeInteger(record.acceptedItems, X_BOOKMARKS_CEILINGS.maxItems);
  const acceptedBytes = nonNegativeInteger(
    record.acceptedBytes,
    X_BOOKMARKS_CEILINGS.maxTotalBytes,
  );
  const elapsedMs = nonNegativeInteger(record.elapsedMs);
  return observedNodes === null ||
    acceptedItems === null ||
    acceptedBytes === null ||
    elapsedMs === null
    ? null
    : { observedNodes, acceptedItems, acceptedBytes, elapsedMs };
}

function isNormalizedText(value: string | undefined): boolean {
  return value === undefined || (value.normalize('NFC') === value && !value.includes('\r'));
}

function hasCanonicalMediaUrl(value: string): boolean {
  if (!value.startsWith('https://') || value.includes('\\')) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.hash === '' &&
      parsed.href === value
    );
  } catch {
    return false;
  }
}

function hasCanonicalAdapterFields(item: SocialItem): boolean {
  const permalinkMatch = X_CANONICAL_PERMALINK_PATTERN.exec(item.canonicalUrl);
  const account = permalinkMatch?.[1];
  const permalinkSourceItemId = permalinkMatch?.[2];
  if (
    !account ||
    permalinkSourceItemId !== item.sourceItemId ||
    item.author?.handle !== account ||
    !isNormalizedText(item.title) ||
    !isNormalizedText(item.text) ||
    !isNormalizedText(item.author?.displayName) ||
    !isNormalizedText(item.author?.handle) ||
    textEncoder.encode(item.text ?? '').byteLength > X_BOOKMARKS_CEILINGS.maxTextBytes ||
    item.media.length > X_BOOKMARKS_CEILINGS.maxMedia
  ) {
    return false;
  }
  let previousMediaKey: string | undefined;
  for (const media of item.media) {
    if (!hasCanonicalMediaUrl(media.url) || !isNormalizedText(media.alt)) {
      return false;
    }
    const key = `${media.type}\u0000${media.url}\u0000${media.alt ?? ''}`;
    if (previousMediaKey !== undefined && key <= previousMediaKey) {
      return false;
    }
    previousMediaKey = key;
  }
  return true;
}

function serializeContentHashInput(item: SocialItem): string {
  return JSON.stringify({
    schemaVersion: item.schemaVersion,
    source: item.source,
    sourceItemId: item.sourceItemId,
    canonicalUrl: item.canonicalUrl,
    title: item.title ?? null,
    text: item.text ?? null,
    author:
      item.author === undefined
        ? null
        : {
            displayName: item.author.displayName ?? null,
            handle: item.author.handle ?? null,
          },
    publishedAt: item.publishedAt ?? null,
    completeness: item.completeness,
    media: item.media.map((media) => ({
      type: media.type,
      url: media.url,
      alt: media.alt ?? null,
    })),
    extractorVersion: item.extractorVersion,
  });
}

async function computeContentHash(item: SocialItem): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      return null;
    }
    const digest = await subtle.digest(
      'SHA-256',
      textEncoder.encode(serializeContentHashInput(item)),
    );
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function serializedBytes(value: unknown): number | null {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

async function parseAdapterBatchResult(value: unknown): Promise<ParsedBatch | null> {
  const record = inspectStrictRecord(value, new Set(['capability', 'signal', 'items', 'metrics']));
  if (!record || !hasExactKeys(record, ['capability', 'items', 'metrics', 'signal'])) {
    return null;
  }
  const capability = parseCapability(record.capability);
  const signal = parseSignal(record.signal);
  const metrics = parseMetrics(record.metrics);
  const rawItems = inspectPlainArray(record.items, X_BOOKMARKS_CEILINGS.maxItems);
  if (!capability || !signal || !metrics || !rawItems) {
    return null;
  }

  const items: SocialItem[] = [];
  const itemBytes: number[] = [];
  const ids = new Set<string>();
  for (const rawItem of rawItems) {
    const parsed = SocialItemSchema.safeParse(rawItem);
    if (
      !parsed.success ||
      parsed.data.source !== 'x' ||
      !hasCanonicalAdapterFields(parsed.data) ||
      ids.has(parsed.data.sourceItemId)
    ) {
      return null;
    }
    const expectedHash = await computeContentHash(parsed.data);
    if (expectedHash === null || expectedHash !== parsed.data.contentHash) {
      return null;
    }
    const bytes = serializedBytes(parsed.data);
    if (bytes === null || bytes > SYNC_LIMITS.socialItemBytes) {
      return null;
    }
    ids.add(parsed.data.sourceItemId);
    items.push(parsed.data);
    itemBytes.push(bytes);
  }
  const acceptedBytes = itemBytes.reduce((total, bytes) => total + bytes, 0);
  if (
    metrics.acceptedItems !== items.length ||
    metrics.acceptedBytes !== acceptedBytes ||
    metrics.observedNodes < items.length
  ) {
    return null;
  }
  if (
    (signal.kind === 'items' && items.length === 0) ||
    (['empty', 'challenge', 'structure_changed', 'unsupported'].includes(signal.kind) &&
      items.length !== 0) ||
    (capability.kind === 'unsupported' && signal.kind !== 'unsupported') ||
    (capability.kind === 'collection_scan' && signal.kind === 'unsupported')
  ) {
    return null;
  }
  return {
    result: { capability, signal, items, metrics },
    itemBytes,
  };
}

function sameStableItem(left: SocialItem, right: SocialItem): boolean {
  return (
    left.source === right.source &&
    left.sourceItemId === right.sourceItemId &&
    left.canonicalUrl === right.canonicalUrl &&
    left.contentHash === right.contentHash &&
    left.completeness === right.completeness &&
    left.extractorVersion === right.extractorVersion
  );
}

function sameCatalogIdentity(item: SocialItem, record: SyncRecord): boolean {
  return (
    item.source === record.source &&
    item.sourceItemId === record.sourceItemId &&
    item.canonicalUrl === record.canonicalUrl &&
    item.contentHash === record.contentHash &&
    item.completeness === record.completeness &&
    item.extractorVersion === record.extractorVersion
  );
}

function parseOptionalRecord(value: unknown): SyncRecord | undefined {
  return value === undefined ? undefined : SyncRecordSchema.parse(value);
}

function assertRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_REVISION) {
    throw new RangeError('expectedScanRevision must be an integer between 0 and 1000000');
  }
  return value;
}

function minimumLimits(
  requested: Readonly<XBookmarksLimits>,
  job: SyncJob,
): Readonly<XBookmarksLimits> {
  return Object.freeze({
    maxItems: Math.min(requested.maxItems, job.budgets.maxItems),
    maxBatches: Math.min(requested.maxBatches, job.budgets.maxPages),
    maxObservedNodes: requested.maxObservedNodes,
    maxElapsedMs: Math.min(requested.maxElapsedMs, job.budgets.maxDurationMs),
    maxTextBytes: requested.maxTextBytes,
    maxMedia: Math.min(requested.maxMedia, job.budgets.maxMediaPerItem),
    maxTotalBytes: requested.maxTotalBytes,
    maxCheckpointBytes: requested.maxCheckpointBytes,
    maxConsecutiveStructureErrors: Math.min(
      requested.maxConsecutiveStructureErrors,
      X_BOOKMARKS_CEILINGS.maxConsecutiveStructureErrors,
    ),
  });
}

function invocationMetrics(
  progress: InvocationProgress,
  elapsedMs: number,
): XSyncInvocationMetrics {
  return Object.freeze({
    steps: progress.steps,
    observedNodes: progress.observedNodes,
    elapsedMs,
    insertedItems: progress.insertedItems,
    replayedItems: progress.replayedItems,
  });
}

export class XSyncCoordinator {
  private readonly now: () => number;
  private readonly nowIso: () => string;

  constructor(
    private readonly store: XSyncCoordinatorStorePort,
    private readonly catalog: SyncCatalogLookupPort,
    private readonly adapter: AdapterBatchPort,
    options: XSyncCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
  }

  async createAndStart(input: CreateAndStartXSyncInput): Promise<XSyncInvocationResult> {
    const jobId = SyncJobIdSchema.parse(input.jobId);
    const limits = this.resolveLimits(input.limits);
    const createdAt =
      input.createdAt === undefined ? this.timestamp() : IsoTimestampSchema.parse(input.createdAt);
    const job = await this.store.createJob({
      id: jobId,
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      budgets: {
        maxItems: limits.maxItems,
        maxPages: limits.maxBatches,
        maxDurationMs: limits.maxElapsedMs,
        maxItemBytes: SYNC_LIMITS.socialItemBytes,
        maxMediaPerItem: limits.maxMedia,
      },
      createdAt,
    });
    if (job.status !== 'prepared' || job.scanRevision !== 0) {
      throw new XSyncCoordinatorError(
        'invalid_state',
        'A replayed create command cannot resume or replace an existing sync job',
      );
    }
    return this.claimAndRun(job, 0, limits);
  }

  async start(input: StartOrResumeXSyncInput): Promise<XSyncInvocationResult> {
    const job = await this.requireJob(input.jobId);
    if (job.status !== 'prepared') {
      throw new XSyncCoordinatorError('invalid_state', 'Only a prepared X sync job can start');
    }
    return this.claimAndRun(job, assertRevision(input.expectedScanRevision), input.limits);
  }

  async resume(input: StartOrResumeXSyncInput): Promise<XSyncInvocationResult> {
    const job = await this.requireJob(input.jobId);
    if (
      job.status !== 'paused' ||
      job.stopRecord?.phase !== 'scanning' ||
      job.writeAuthorizedAt !== undefined
    ) {
      throw new XSyncCoordinatorError(
        'invalid_state',
        'Only a paused scanning job can resume through the X coordinator',
      );
    }
    return this.claimAndRun(job, assertRevision(input.expectedScanRevision), input.limits);
  }

  async pause(input: PauseXSyncInput): Promise<SyncJob> {
    const jobId = SyncJobIdSchema.parse(input.jobId);
    return this.store.pauseJobWithStopRecord(
      jobId,
      assertRevision(input.expectedScanRevision),
      'user_paused',
      'scanning',
      this.timestamp(),
    );
  }

  private async requireJob(jobIdInput: string): Promise<SyncJob> {
    const jobId = SyncJobIdSchema.parse(jobIdInput);
    const rawJob = await this.store.getJob(jobId);
    if (!rawJob) {
      throw new XSyncCoordinatorError('invalid_state', 'X sync job was not found');
    }
    const job = SyncJobSchema.parse(rawJob);
    if (job.source !== 'x') {
      throw new XSyncCoordinatorError('invalid_state', 'The sync job does not belong to X');
    }
    return job;
  }

  private resolveLimits(input: unknown): Readonly<XBookmarksLimits> {
    const limits = resolveXBookmarksLimits(input);
    if (!limits) {
      throw new TypeError('X sync limits are invalid');
    }
    return limits;
  }

  private timestamp(): string {
    try {
      return IsoTimestampSchema.parse(this.nowIso());
    } catch {
      throw new XSyncCoordinatorError('invalid_clock', 'The coordinator clock is invalid');
    }
  }

  private clockMillis(): number {
    let value: number;
    try {
      value = this.now();
    } catch {
      throw new XSyncCoordinatorError('invalid_clock', 'The coordinator clock is unavailable');
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new XSyncCoordinatorError('invalid_clock', 'The coordinator clock is invalid');
    }
    return value;
  }

  private elapsed(startedAt: number, reportedElapsedMs: number): number {
    const elapsed = this.clockMillis() - startedAt;
    if (elapsed < 0) {
      throw new XSyncCoordinatorError('invalid_clock', 'The coordinator clock moved backwards');
    }
    return Math.max(Math.floor(elapsed), reportedElapsedMs);
  }

  private async runWithinDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T | typeof INVOCATION_DEADLINE_EXCEEDED> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof INVOCATION_DEADLINE_EXCEEDED>((resolve) => {
      timeoutHandle = setTimeout(
        () => {
          controller.abort();
          resolve(INVOCATION_DEADLINE_EXCEEDED);
        },
        Math.max(1, Math.ceil(timeoutMs)),
      );
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        timeout,
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async claimAndRun(
    previousJob: SyncJob,
    expectedScanRevision: number,
    limitsInput: unknown,
  ): Promise<XSyncInvocationResult> {
    const requestedLimits = this.resolveLimits(limitsInput);
    const claimed = SyncJobSchema.parse(
      await this.store.claimScanRevision(previousJob.id, expectedScanRevision, this.timestamp()),
    );
    const limits = minimumLimits(requestedLimits, claimed);
    const progress: InvocationProgress = {
      steps: 0,
      observedNodes: 0,
      reportedElapsedMs: 0,
      insertedItems: 0,
      replayedItems: 0,
    };
    const startedAt = this.clockMillis();
    const runWithRemainingBudget = async <T>(
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | typeof INVOCATION_DEADLINE_EXCEEDED> => {
      const elapsedBeforeOperation = this.elapsed(startedAt, progress.reportedElapsedMs);
      const remainingMs = limits.maxElapsedMs - elapsedBeforeOperation;
      if (remainingMs <= 0) {
        progress.reportedElapsedMs = Math.max(progress.reportedElapsedMs, limits.maxElapsedMs);
        return INVOCATION_DEADLINE_EXCEEDED;
      }
      const outcome = await this.runWithinDeadline(operation, remainingMs);
      if (outcome === INVOCATION_DEADLINE_EXCEEDED) {
        progress.reportedElapsedMs = Math.max(
          progress.reportedElapsedMs,
          elapsedBeforeOperation + remainingMs,
        );
      }
      return outcome;
    };

    if (claimed.source !== 'x' || claimed.adapterVersion !== X_BOOKMARKS_ADAPTER_VERSION) {
      return this.pauseResult(claimed, 'structure_changed', progress, startedAt);
    }

    const knownItemsResult = await runWithRemainingBudget(() => this.loadKnownItems(claimed));
    if (knownItemsResult === INVOCATION_DEADLINE_EXCEEDED) {
      return this.pauseResult(claimed, 'budget_exceeded', progress, startedAt);
    }
    const knownItems = knownItemsResult;
    const pendingClassificationResult = await runWithRemainingBudget(() =>
      this.classifyPendingItems(claimed, knownItems),
    );
    if (pendingClassificationResult === INVOCATION_DEADLINE_EXCEEDED) {
      return this.pauseResult(claimed, 'budget_exceeded', progress, startedAt);
    }
    const currentJobResult = await runWithRemainingBudget(() => this.store.getJob(claimed.id));
    if (currentJobResult === INVOCATION_DEADLINE_EXCEEDED) {
      return this.pauseResult(claimed, 'budget_exceeded', progress, startedAt);
    }
    let currentJob = SyncJobSchema.parse(currentJobResult ?? claimed);
    if (
      currentJob.checkpoint &&
      (currentJob.checkpoint.acceptedCount >= limits.maxItems ||
        currentJob.checkpoint.acceptedBytes >= limits.maxTotalBytes)
    ) {
      return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
    }

    for (let step = 1; step <= limits.maxBatches; step += 1) {
      const elapsedBefore = this.elapsed(startedAt, progress.reportedElapsedMs);
      if (
        elapsedBefore >= limits.maxElapsedMs ||
        progress.observedNodes >= limits.maxObservedNodes
      ) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const checkpoint = currentJob.checkpoint;
      const requestLimits = Object.freeze({
        ...limits,
        maxObservedNodes: limits.maxObservedNodes - progress.observedNodes,
        maxElapsedMs: limits.maxElapsedMs - elapsedBefore,
      });
      const request: AdapterBatchRequest = Object.freeze({
        source: 'x',
        adapterVersion: currentJob.adapterVersion,
        scanRevision: currentJob.scanRevision,
        step,
        jobAcceptedItems: checkpoint?.acceptedCount ?? 0,
        jobAcceptedBytes: checkpoint?.acceptedBytes ?? 0,
        invocationObservedNodes: progress.observedNodes,
        invocationElapsedMs: elapsedBefore,
        limits: requestLimits,
      });

      let parsedBatch: ParsedBatch | null;
      try {
        const rawBatch = await runWithRemainingBudget(() => this.adapter.readBatch(request));
        if (rawBatch === INVOCATION_DEADLINE_EXCEEDED) {
          return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
        }
        const parsedBatchResult = await runWithRemainingBudget(() =>
          parseAdapterBatchResult(rawBatch),
        );
        if (parsedBatchResult === INVOCATION_DEADLINE_EXCEEDED) {
          return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
        }
        parsedBatch = parsedBatchResult;
      } catch {
        parsedBatch = null;
      }
      if (!parsedBatch) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }

      const { result } = parsedBatch;
      progress.steps = step;
      progress.observedNodes += result.metrics.observedNodes;
      progress.reportedElapsedMs += result.metrics.elapsedMs;
      const elapsedAfter = this.elapsed(startedAt, progress.reportedElapsedMs);
      if (
        result.metrics.observedNodes > requestLimits.maxObservedNodes ||
        result.metrics.elapsedMs > requestLimits.maxElapsedMs
      ) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }
      if (elapsedAfter >= limits.maxElapsedMs) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      if (result.capability.kind === 'unsupported' || result.signal.kind === 'unsupported') {
        return this.pauseResult(currentJob, 'tab_changed', progress, startedAt);
      }
      if (
        result.capability.adapterVersion !== currentJob.adapterVersion ||
        result.items.some(
          (item, index) =>
            item.extractorVersion !== currentJob.adapterVersion ||
            textEncoder.encode(item.text ?? '').byteLength > requestLimits.maxTextBytes ||
            item.media.length > requestLimits.maxMedia ||
            parsedBatch!.itemBytes[index]! > currentJob.budgets.maxItemBytes,
        )
      ) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }

      if (
        result.signal.kind === 'challenge' ||
        result.signal.kind === 'structure_changed' ||
        result.signal.kind === 'empty'
      ) {
        const stopReason =
          result.signal.kind === 'challenge' ? result.signal.stopReason : 'structure_changed';
        return this.pauseResult(currentJob, stopReason, progress, startedAt);
      }

      const filtered = this.filterReplayedItems(result.items, knownItems);
      if (!filtered.ok) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }
      const previousAcceptedCount = checkpoint?.acceptedCount ?? 0;
      const previousAcceptedBytes = checkpoint?.acceptedBytes ?? 0;
      const acceptedCount = previousAcceptedCount + filtered.items.length;
      const acceptedBytes = previousAcceptedBytes + result.metrics.acceptedBytes;
      if (acceptedCount > limits.maxItems || acceptedBytes > limits.maxTotalBytes) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const nextCheckpoint = this.nextCheckpoint(
        currentJob,
        result.items,
        knownItems,
        filtered.items,
        result.metrics.acceptedBytes,
      );
      const checkpointBytes = serializedBytes(nextCheckpoint);
      if (checkpointBytes === null || checkpointBytes > limits.maxCheckpointBytes) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const persistedResult = await runWithRemainingBudget(() =>
        this.store.putScanBatch(
          currentJob.id,
          currentJob.scanRevision,
          filtered.items,
          nextCheckpoint,
        ),
      );
      if (persistedResult === INVOCATION_DEADLINE_EXCEEDED) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      const persisted = persistedResult;
      currentJob = SyncJobSchema.parse(persisted.job);
      progress.insertedItems += persisted.inserted;
      progress.replayedItems += result.items.length - persisted.inserted;
      for (const item of filtered.items) {
        knownItems.set(item.sourceItemId, item);
      }

      for (const item of filtered.items) {
        const classificationResult = await runWithRemainingBudget(() => this.classifyItem(item));
        if (classificationResult === INVOCATION_DEADLINE_EXCEEDED) {
          return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
        }
        const updateResult = await runWithRemainingBudget(() =>
          this.store.updateJobItemClassification(
            currentJob.id,
            item.sourceItemId,
            classificationResult,
            currentJob.scanRevision,
            this.timestamp(),
          ),
        );
        if (updateResult === INVOCATION_DEADLINE_EXCEEDED) {
          return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
        }
      }
      const refreshedJobResult = await runWithRemainingBudget(() =>
        this.store.getJob(currentJob.id),
      );
      if (refreshedJobResult === INVOCATION_DEADLINE_EXCEEDED) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      currentJob = SyncJobSchema.parse(refreshedJobResult ?? currentJob);
      const elapsedAfterPersistence = this.elapsed(startedAt, progress.reportedElapsedMs);
      if (elapsedAfterPersistence >= limits.maxElapsedMs) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      if (result.signal.kind === 'terminal') {
        let finishedResult: SyncJob | typeof INVOCATION_DEADLINE_EXCEEDED;
        try {
          finishedResult = await runWithRemainingBudget((signal) =>
            this.store.finishScan(currentJob.id, currentJob.scanRevision, this.timestamp(), {
              signal,
              beforeCommit: () =>
                this.elapsed(startedAt, progress.reportedElapsedMs) < limits.maxElapsedMs,
            }),
          );
        } catch (error) {
          if (this.elapsed(startedAt, progress.reportedElapsedMs) >= limits.maxElapsedMs) {
            return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
          }
          throw error;
        }
        if (finishedResult === INVOCATION_DEADLINE_EXCEEDED) {
          return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
        }
        const finished = SyncJobSchema.parse(finishedResult);
        return {
          outcome: 'ready_for_review',
          job: finished,
          metrics: invocationMetrics(progress, this.elapsed(startedAt, progress.reportedElapsedMs)),
        };
      }
      if (
        result.signal.kind === 'budget_exceeded' ||
        currentJob.checkpoint?.acceptedCount === limits.maxItems ||
        currentJob.checkpoint?.acceptedBytes === limits.maxTotalBytes ||
        progress.observedNodes === limits.maxObservedNodes ||
        elapsedAfterPersistence >= limits.maxElapsedMs ||
        step === limits.maxBatches
      ) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
    }

    return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
  }

  private async loadKnownItems(job: SyncJob): Promise<Map<string, SocialItem>> {
    const rawItems = await this.store.listJobItems(job.id, { limit: job.budgets.maxItems });
    if (rawItems.length !== job.summary.uniqueItemCount) {
      throw new XSyncCoordinatorError(
        'invalid_store_state',
        'Persisted X sync item count differs from the job summary',
      );
    }
    const known = new Map<string, SocialItem>();
    for (const rawItem of rawItems) {
      const row = SyncJobItemSchema.parse(rawItem);
      if (row.jobId !== job.id || row.item.source !== 'x' || known.has(row.sourceItemId)) {
        throw new XSyncCoordinatorError(
          'invalid_store_state',
          'Persisted X sync items are inconsistent',
        );
      }
      known.set(row.sourceItemId, row.item);
    }
    return known;
  }

  private async classifyPendingItems(
    job: SyncJob,
    knownItems: ReadonlyMap<string, SocialItem>,
  ): Promise<void> {
    const rows = await this.store.listJobItems(job.id, { limit: job.budgets.maxItems });
    for (const rawRow of rows) {
      const row = SyncJobItemSchema.parse(rawRow);
      if (row.classification !== 'pending') {
        continue;
      }
      const item = knownItems.get(row.sourceItemId);
      if (!item) {
        throw new XSyncCoordinatorError(
          'invalid_store_state',
          'A pending sync item is missing from the persisted item set',
        );
      }
      await this.store.updateJobItemClassification(
        job.id,
        row.sourceItemId,
        await this.classifyItem(item),
        job.scanRevision,
        this.timestamp(),
      );
    }
  }

  private filterReplayedItems(
    items: readonly SocialItem[],
    knownItems: ReadonlyMap<string, SocialItem>,
  ): { readonly ok: true; readonly items: readonly SocialItem[] } | { readonly ok: false } {
    const fresh: SocialItem[] = [];
    for (const item of items) {
      const known = knownItems.get(item.sourceItemId);
      if (known) {
        if (!sameStableItem(known, item)) {
          return { ok: false };
        }
        continue;
      }
      fresh.push(item);
    }
    return { ok: true, items: fresh };
  }

  private nextCheckpoint(
    job: SyncJob,
    observedItems: readonly SocialItem[],
    knownItems: ReadonlyMap<string, SocialItem>,
    freshItems: readonly SocialItem[],
    observedAcceptedBytes: number,
  ): SyncCheckpoint {
    let consecutiveKnownIds = job.checkpoint?.consecutiveKnownIds ?? 0;
    const freshIds = new Set(freshItems.map((item) => item.sourceItemId));
    for (const item of observedItems) {
      if (knownItems.has(item.sourceItemId) && !freshIds.has(item.sourceItemId)) {
        consecutiveKnownIds += 1;
      } else {
        consecutiveKnownIds = 0;
      }
    }
    return {
      schemaVersion: 1,
      adapterVersion: job.adapterVersion,
      scanRevision: job.scanRevision,
      scannedCount: (job.checkpoint?.scannedCount ?? 0) + observedItems.length,
      acceptedCount: (job.checkpoint?.acceptedCount ?? 0) + freshItems.length,
      acceptedBytes: (job.checkpoint?.acceptedBytes ?? 0) + observedAcceptedBytes,
      consecutiveKnownIds,
      updatedAt: this.timestamp(),
    };
  }

  private async classifyItem(item: SocialItem): Promise<SyncItemClassification> {
    try {
      const recordKey = makeSyncRecordKey(item.source, item.sourceItemId);
      const keyMatch = parseOptionalRecord(await this.catalog.getRecordByKey(recordKey));
      if (keyMatch) {
        if (keyMatch.key !== recordKey) {
          return 'error';
        }
        return sameCatalogIdentity(item, keyMatch) ? 'existing' : 'changed';
      }

      const canonicalMatch = parseOptionalRecord(
        await this.catalog.getRecordByCanonicalUrl(item.canonicalUrl),
      );
      if (canonicalMatch && canonicalMatch.canonicalUrl !== item.canonicalUrl) {
        return 'error';
      }
      const hashMatch = parseOptionalRecord(
        await this.catalog.getRecordByContentHash(item.contentHash),
      );
      if (hashMatch && hashMatch.contentHash !== item.contentHash) {
        return 'error';
      }
      if (
        (canonicalMatch && canonicalMatch.key === recordKey) ||
        (hashMatch && hashMatch.key === recordKey)
      ) {
        return 'error';
      }
      if (canonicalMatch || hashMatch) {
        return 'incomplete';
      }
      return item.completeness === 'complete' || item.completeness === 'summary_only'
        ? 'new'
        : 'incomplete';
    } catch {
      return 'error';
    }
  }

  private async pauseResult(
    job: SyncJob,
    stopReason: SyncStopReason,
    progress: InvocationProgress,
    startedAt: number,
  ): Promise<XSyncInvocationResult> {
    const paused = SyncJobSchema.parse(
      await this.store.pauseJobWithStopRecord(
        job.id,
        job.scanRevision,
        stopReason,
        'scanning',
        this.timestamp(),
      ),
    );
    return {
      outcome: 'paused',
      stopReason,
      job: paused,
      metrics: invocationMetrics(progress, this.elapsed(startedAt, progress.reportedElapsedMs)),
    };
  }
}
