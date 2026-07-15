import {
  IsoTimestampSchema,
  SocialItemSchema,
  SyncJobSchema,
  SyncJobIdSchema,
  SYNC_LIMITS,
  XSourceItemIdSchema,
  type SocialItem,
  type SyncJob,
  type SyncScanCompletion,
  type SyncScanMode,
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
  readonly mode: SyncScanMode;
  readonly scanRevision: number;
  readonly step: number;
  readonly jobCandidateItems: number;
  readonly remainingCandidateSlots: number;
  readonly jobAcceptedBytes: number;
  readonly invocationObservedNodes: number;
  readonly invocationElapsedMs: number;
  readonly scrollActionsUsed: number;
  readonly maxScrollActionsRemaining: number;
  readonly candidateSourceItemIds: readonly string[];
  readonly knownFrontierSourceItemIds: readonly string[];
  readonly limits: Readonly<XBookmarksLimits>;
}

/** Adapter output remains untrusted even when the implementation is typed. */
export interface AdapterBatchPort {
  readBatch(request: AdapterBatchRequest, signal?: AbortSignal): Promise<unknown>;
  verifyBinding?(request: AdapterBatchRequest, signal?: AbortSignal): Promise<void>;
}

export interface XSyncCoordinatorStorePort {
  getJob(jobId: string): Promise<SyncJob | undefined>;
  listJobItems(
    jobId: string,
    options?: { readonly limit?: number },
  ): Promise<
    Array<{
      readonly sourceItemId: string;
      readonly classification: 'pending' | 'new' | 'existing' | 'changed' | 'incomplete' | 'error';
    }>
  >;
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
      readonly scanCompletion?: SyncScanCompletion;
    },
  ): Promise<SyncJob>;
  classifyAndPersistScanBatch(
    jobId: string,
    expectedScanRevision: number,
    observations: readonly unknown[],
    observedNodeDelta: number,
    updatedAt?: string,
    guard?: {
      readonly signal?: AbortSignal;
      readonly beforeCommit?: () => boolean;
    },
  ): Promise<{
    insertedCandidates: number;
    replayedCandidates: number;
    catalogExistingObservations: number;
    classifications: Array<{
      sourceItemId: string;
      classification: 'new' | 'existing' | 'changed' | 'incomplete' | 'error';
    }>;
    job: SyncJob;
  }>;
}

export interface XSyncCoordinatorOptions {
  readonly now?: () => number;
  readonly nowIso?: () => string;
  readonly onProgress?: (input: {
    readonly job: SyncJob;
    readonly metrics: XSyncInvocationMetrics;
  }) => void;
}

export interface StartOrResumeXSyncInput {
  readonly jobId: string;
  readonly expectedScanRevision: number;
  readonly limits?: unknown;
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

export type XSyncAdapterStopReason = SyncStopReason;

export class XSyncAdapterStopError extends Error {
  readonly stopReason: XSyncAdapterStopReason;

  constructor(stopReason: XSyncAdapterStopReason) {
    super('The X adapter invocation stopped');
    this.name = 'XSyncAdapterStopError';
    this.stopReason = stopReason;
  }
}

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
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    prototype = isArray ? Object.getPrototypeOf(value) : null;
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, 'length') : undefined;
  } catch {
    return null;
  }
  if (!isArray || prototype !== Array.prototype) {
    return null;
  }
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
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
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
  if (record.kind === 'no_progress') {
    return record.stopReason === 'no_progress' && hasExactKeys(record, ['kind', 'stopReason'])
      ? { kind: 'no_progress', stopReason: 'no_progress' }
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
    return [
      'candidate_items',
      'accepted_bytes',
      'elapsed_time',
      'observed_nodes',
      'scroll_actions',
    ].includes(budget) &&
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
    (['empty', 'no_progress', 'challenge', 'structure_changed', 'unsupported'].includes(
      signal.kind,
    ) &&
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
    maxScrollActions: requested.maxScrollActions,
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
  private readonly onProgress?: XSyncCoordinatorOptions['onProgress'];

  constructor(
    private readonly store: XSyncCoordinatorStorePort,
    private readonly adapter: AdapterBatchPort,
    options: XSyncCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.onProgress = options.onProgress;
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

    let currentJob = claimed;
    if (
      currentJob.checkpoint &&
      (currentJob.checkpoint.candidateCount >= limits.maxItems ||
        currentJob.checkpoint.acceptedBytes >= limits.maxTotalBytes)
    ) {
      return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
    }

    const persistedItemsResult = await runWithRemainingBudget(() =>
      this.store.listJobItems(currentJob.id, { limit: X_BOOKMARKS_CEILINGS.maxItems }),
    );
    if (persistedItemsResult === INVOCATION_DEADLINE_EXCEEDED) {
      return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
    }
    const candidateSourceItemIds = new Set<string>();
    for (const persistedItem of persistedItemsResult) {
      const sourceItemId = XSourceItemIdSchema.safeParse(persistedItem.sourceItemId);
      if (!sourceItemId.success) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }
      if (persistedItem.classification !== 'existing') {
        candidateSourceItemIds.add(sourceItemId.data);
      }
    }
    const invocationSeenStableIds = new Set<string>();
    let consecutiveNoProgressBatches = 0;
    const maximumSteps = Math.min(limits.maxBatches, limits.maxScrollActions);
    for (let step = 0; step < maximumSteps; step += 1) {
      const elapsedBefore = this.elapsed(startedAt, progress.reportedElapsedMs);
      if (
        elapsedBefore >= limits.maxElapsedMs ||
        progress.observedNodes >= limits.maxObservedNodes
      ) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const checkpoint = currentJob.checkpoint;
      const knownFrontierSourceItemIds = checkpoint?.knownFrontierSourceItemIds ?? [];
      if (
        knownFrontierSourceItemIds.some((sourceItemId) => candidateSourceItemIds.has(sourceItemId))
      ) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }
      const jobCandidateItems = checkpoint?.candidateCount ?? 0;
      const remainingCandidateSlots = limits.maxItems - jobCandidateItems;
      if (remainingCandidateSlots <= 0) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      const requestLimits = Object.freeze({
        ...limits,
        maxObservedNodes: limits.maxObservedNodes - progress.observedNodes,
        maxElapsedMs: limits.maxElapsedMs - elapsedBefore,
      });
      const request: AdapterBatchRequest = Object.freeze({
        source: 'x',
        adapterVersion: currentJob.adapterVersion,
        mode: currentJob.scanMode,
        scanRevision: currentJob.scanRevision,
        step,
        jobCandidateItems,
        remainingCandidateSlots,
        jobAcceptedBytes: checkpoint?.acceptedBytes ?? 0,
        invocationObservedNodes: progress.observedNodes,
        invocationElapsedMs: elapsedBefore,
        scrollActionsUsed: step,
        maxScrollActionsRemaining: limits.maxScrollActions - step,
        candidateSourceItemIds: Object.freeze(
          [...candidateSourceItemIds].slice(0, X_BOOKMARKS_CEILINGS.maxItems),
        ),
        knownFrontierSourceItemIds: Object.freeze([...knownFrontierSourceItemIds]),
        limits: requestLimits,
      });

      let parsedBatch: ParsedBatch | null;
      try {
        const rawBatch = await runWithRemainingBudget((signal) =>
          this.adapter.readBatch(request, signal),
        );
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
      } catch (error) {
        if (error instanceof XSyncAdapterStopError) {
          return this.pauseResult(currentJob, error.stopReason, progress, startedAt);
        }
        parsedBatch = null;
      }
      if (!parsedBatch) {
        return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
      }

      const { result } = parsedBatch;
      progress.steps = step + 1;
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
      const previousAcceptedBytes = checkpoint?.acceptedBytes ?? 0;
      const acceptedBytes = previousAcceptedBytes + result.metrics.acceptedBytes;
      if (acceptedBytes > limits.maxTotalBytes) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const persistedResult = await runWithRemainingBudget((signal) =>
        this.store.classifyAndPersistScanBatch(
          currentJob.id,
          currentJob.scanRevision,
          result.items,
          result.metrics.observedNodes,
          this.timestamp(),
          {
            signal,
            beforeCommit: () =>
              this.elapsed(startedAt, progress.reportedElapsedMs) < limits.maxElapsedMs,
          },
        ),
      );
      if (persistedResult === INVOCATION_DEADLINE_EXCEEDED) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      const persisted = persistedResult;
      currentJob = SyncJobSchema.parse(persisted.job);
      progress.insertedItems += persisted.insertedCandidates;
      progress.replayedItems +=
        persisted.replayedCandidates + persisted.catalogExistingObservations;
      this.reportProgress(currentJob, progress, startedAt);
      let newStableIds = 0;
      for (const classification of persisted.classifications) {
        if (classification.classification !== 'existing') {
          candidateSourceItemIds.add(classification.sourceItemId);
        }
        if (!invocationSeenStableIds.has(classification.sourceItemId)) {
          invocationSeenStableIds.add(classification.sourceItemId);
          newStableIds += 1;
        }
      }
      consecutiveNoProgressBatches = newStableIds === 0 ? consecutiveNoProgressBatches + 1 : 0;
      const checkpointBytes = serializedBytes(currentJob.checkpoint);
      if (checkpointBytes === null || checkpointBytes > limits.maxCheckpointBytes) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
      const elapsedAfterPersistence = this.elapsed(startedAt, progress.reportedElapsedMs);
      if (elapsedAfterPersistence >= limits.maxElapsedMs) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }

      const scanCompletion: SyncScanCompletion | undefined =
        result.signal.kind === 'terminal'
          ? 'trusted_terminal'
          : currentJob.scanMode === 'incremental' &&
              (currentJob.checkpoint?.consecutiveKnownIds ?? 0) >= 20
            ? 'known_frontier'
            : undefined;
      if (scanCompletion) {
        if (this.adapter.verifyBinding) {
          try {
            const verified = await runWithRemainingBudget((signal) =>
              this.adapter.verifyBinding!(request, signal),
            );
            if (verified === INVOCATION_DEADLINE_EXCEEDED) {
              return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
            }
          } catch (error) {
            if (error instanceof XSyncAdapterStopError) {
              return this.pauseResult(currentJob, error.stopReason, progress, startedAt);
            }
            return this.pauseResult(currentJob, 'structure_changed', progress, startedAt);
          }
        }
        let finishedResult: SyncJob | typeof INVOCATION_DEADLINE_EXCEEDED;
        try {
          finishedResult = await runWithRemainingBudget((signal) =>
            this.store.finishScan(currentJob.id, currentJob.scanRevision, this.timestamp(), {
              signal,
              beforeCommit: () =>
                this.elapsed(startedAt, progress.reportedElapsedMs) < limits.maxElapsedMs,
              scanCompletion,
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
      if (result.signal.kind === 'no_progress' || consecutiveNoProgressBatches >= 3) {
        return this.pauseResult(currentJob, 'no_progress', progress, startedAt);
      }
      const adapterHitPersistedCandidateLimit =
        result.signal.kind === 'budget_exceeded' && result.signal.budget !== 'candidate_items';
      if (
        adapterHitPersistedCandidateLimit ||
        currentJob.checkpoint?.candidateCount === limits.maxItems ||
        currentJob.checkpoint?.acceptedBytes === limits.maxTotalBytes ||
        progress.observedNodes === limits.maxObservedNodes ||
        elapsedAfterPersistence >= limits.maxElapsedMs ||
        step + 1 === maximumSteps
      ) {
        return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
      }
    }

    return this.pauseResult(currentJob, 'budget_exceeded', progress, startedAt);
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

  private reportProgress(job: SyncJob, progress: InvocationProgress, startedAt: number): void {
    if (!this.onProgress) {
      return;
    }
    try {
      this.onProgress({
        job,
        metrics: invocationMetrics(progress, this.elapsed(startedAt, progress.reportedElapsedMs)),
      });
    } catch {
      // UI progress is best-effort and cannot change the persisted scan outcome.
    }
  }
}
