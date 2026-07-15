import { z } from 'zod';

import { SocialItemSchema, SyncJobIdSchema, XSourceItemIdSchema } from './sync-schema.js';

export const X_SYNC_PROTOCOL = 'shuhai:x-sync:v1' as const;
export const X_SYNC_BOOKMARKS_URL = 'https://x.com/i/bookmarks' as const;
export const X_SYNC_LAUNCH_INTENT_TTL_MS = 60_000 as const;

export const X_SYNC_MESSAGE_LIMITS = Object.freeze({
  uiBytes: 64 * 1_024,
  contentBytes: 1 * 1_024 * 1_024,
  portBytes: 64 * 1_024,
  intentBytes: 1 * 1_024,
  bindingBytes: 8 * 1_024,
  maxDepth: 8,
  uiNodes: 512,
  contentNodes: 8_192,
  portNodes: 1_024,
  intentNodes: 64,
  bindingNodes: 64,
  selectedItems: 50,
  knownFrontierItems: 20,
} as const);

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const textEncoder = new TextEncoder();
const INVALID_INPUT = Symbol('invalid-x-sync-input');
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;
const DOCUMENT_ID_PATTERN = /^[\u0021-\u007e]{1,512}$/u;

interface StructuredLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

interface CloneState {
  bytes: number;
  nodes: number;
  readonly seen: WeakSet<object>;
  readonly limits: StructuredLimits;
}

export type XSyncMessageValidationErrorCode =
  | 'invalid_message'
  | 'message_too_large'
  | 'message_too_deep'
  | 'message_too_complex';

export class XSyncMessageValidationError extends Error {
  readonly code: XSyncMessageValidationErrorCode;

  constructor(code: XSyncMessageValidationErrorCode) {
    super('The X sync message is invalid');
    this.name = 'XSyncMessageValidationError';
    this.code = code;
  }
}

function addBytes(state: CloneState, bytes: number): void {
  state.bytes += bytes;
  if (state.bytes > state.limits.maxBytes) {
    throw new XSyncMessageValidationError('message_too_large');
  }
}

function cloneStructuredValue(value: unknown, depth: number, state: CloneState): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    throw new XSyncMessageValidationError('message_too_complex');
  }
  if (depth > state.limits.maxDepth) {
    throw new XSyncMessageValidationError('message_too_deep');
  }

  addBytes(state, 8);
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    if (value.length > state.limits.maxBytes - state.bytes) {
      throw new XSyncMessageValidationError('message_too_large');
    }
    addBytes(state, textEncoder.encode(value).byteLength);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw INVALID_INPUT;
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') {
    throw INVALID_INPUT;
  }
  if (state.seen.has(value)) {
    throw INVALID_INPUT;
  }
  state.seen.add(value);

  let isArray: boolean;
  let prototype: object | null;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw INVALID_INPUT;
  }

  if (isArray) {
    if (prototype !== Array.prototype) {
      throw INVALID_INPUT;
    }
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    } catch {
      throw INVALID_INPUT;
    }
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > state.limits.maxNodes - state.nodes
    ) {
      throw new XSyncMessageValidationError('message_too_complex');
    }
    const length = lengthDescriptor.value as number;
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      throw INVALID_INPUT;
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length + 1 || !keys.includes('length')) {
      throw INVALID_INPUT;
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw INVALID_INPUT;
      }
      output.push(cloneStructuredValue(descriptor.value, depth + 1, state));
    }
    return output;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw INVALID_INPUT;
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw INVALID_INPUT;
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw INVALID_INPUT;
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw INVALID_INPUT;
    }
    if (key.length > state.limits.maxBytes - state.bytes) {
      throw new XSyncMessageValidationError('message_too_large');
    }
    addBytes(state, textEncoder.encode(key).byteLength);
    Object.defineProperty(output, key, {
      value: cloneStructuredValue(descriptor.value, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function boundedClone(input: unknown, limits: StructuredLimits): unknown {
  try {
    return cloneStructuredValue(input, 0, {
      bytes: 0,
      nodes: 0,
      seen: new WeakSet<object>(),
      limits,
    });
  } catch (error) {
    if (error instanceof XSyncMessageValidationError) {
      throw error;
    }
    throw new XSyncMessageValidationError('invalid_message');
  }
}

function parseBounded<T>(input: unknown, schema: z.ZodType<T>, limits: StructuredLimits): T {
  const cloned = boundedClone(input, limits);
  const parsed = schema.safeParse(cloned);
  if (!parsed.success) {
    throw new XSyncMessageValidationError('invalid_message');
  }
  return parsed.data;
}

function boundedString(maxBytes: number, minBytes = 1): z.ZodString {
  return z
    .string()
    .min(1)
    .refine((value) => {
      const size = textEncoder.encode(value).byteLength;
      return size >= minBytes && size <= maxBytes;
    });
}

const revisionSchema = z.number().int().min(0).max(1_000_000);
const positiveVersionSchema = z.number().int().min(1).max(1_000_000);
const tabIdSchema = z.number().int().min(0).max(2_147_483_647);
const windowIdSchema = z.number().int().min(0).max(2_147_483_647);
const requestIdSchema = boundedString(96).regex(SAFE_TOKEN_PATTERN);
const nonceSchema = boundedString(96, 32).regex(SAFE_TOKEN_PATTERN);
const documentIdSchema = boundedString(512).regex(DOCUMENT_ID_PATTERN);
const scanModeSchema = z.enum(['incremental', 'backfill']);
const sourceItemIdsSchema = z
  .array(XSourceItemIdSchema)
  .max(X_SYNC_MESSAGE_LIMITS.selectedItems)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate source item IDs are not allowed' });
    }
  });

const uiRequestBase = {
  protocol: z.literal(X_SYNC_PROTOCOL),
  requestId: requestIdSchema,
};

const uiRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...uiRequestBase, type: z.literal('launch') }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('start'),
    launchNonce: nonceSchema,
    mode: scanModeSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('resume'),
    jobId: SyncJobIdSchema,
    expectedScanRevision: revisionSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('pause'),
    jobId: SyncJobIdSchema,
    expectedScanRevision: revisionSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('finalize'),
    jobId: SyncJobIdSchema,
    expectedScanRevision: revisionSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('cancel'),
    jobId: SyncJobIdSchema,
    expectedScanRevision: revisionSchema,
    expectedReviewRevision: revisionSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('save-selection'),
    jobId: SyncJobIdSchema,
    expectedReviewRevision: revisionSchema,
    selectedSourceItemIds: sourceItemIdsSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('complete-without-writes'),
    jobId: SyncJobIdSchema,
    expectedReviewRevision: revisionSchema,
  }),
  z.strictObject({
    ...uiRequestBase,
    type: z.literal('authorize'),
    jobId: SyncJobIdSchema,
    expectedReviewRevision: revisionSchema,
    selectedSourceItemIds: sourceItemIdsSchema.min(1),
  }),
]);

export type XSyncUiRequest = z.infer<typeof uiRequestSchema>;

const runtimeErrorCodeSchema = z.enum([
  'invalid_message',
  'forbidden_sender',
  'launch_expired',
  'launch_missing',
  'source_conflict',
  'stale_revision',
  'invalid_state',
  'tab_changed',
  'permission_revoked',
  'storage_corrupt',
  'internal_error',
]);
const runtimePhaseSchema = z.enum(['launch', 'scanning', 'review', 'writing']);
const jobStatusSchema = z.enum([
  'prepared',
  'scanning',
  'paused',
  'ready_for_review',
  'writing',
  'partial',
  'complete',
  'complete_with_issues',
  'failed',
  'cancelled',
]);
const stopReasonSchema = z.enum([
  'user_paused',
  'budget_exceeded',
  'login_required',
  'rate_limited',
  'structure_changed',
  'no_progress',
  'tab_changed',
  'permission_revoked',
  'worker_interrupted',
]);

const minimalRuntimeErrorSchema = z.strictObject({
  code: runtimeErrorCodeSchema,
  phase: runtimePhaseSchema,
  jobId: SyncJobIdSchema.optional(),
  scanRevision: revisionSchema.optional(),
});

const uiResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    protocol: z.literal(X_SYNC_PROTOCOL),
    type: z.literal('command-result'),
    requestId: requestIdSchema,
    ok: z.literal(true),
    result: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('launch-intent'),
        nonce: nonceSchema,
        expiresAtMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
      z.strictObject({
        kind: z.literal('accepted'),
        jobId: SyncJobIdSchema,
        scanRevision: revisionSchema,
        reviewRevision: revisionSchema.optional(),
      }),
    ]),
  }),
  z.strictObject({
    protocol: z.literal(X_SYNC_PROTOCOL),
    type: z.literal('command-result'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: minimalRuntimeErrorSchema,
  }),
]);

export type XSyncUiResponse = z.infer<typeof uiResponseSchema>;
export type XSyncMinimalRuntimeError = z.infer<typeof minimalRuntimeErrorSchema>;

const portMessageSchema = z.strictObject({
  protocol: z.literal(X_SYNC_PROTOCOL),
  type: z.literal('runtime-event'),
  event: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('state'),
      jobId: SyncJobIdSchema,
      status: jobStatusSchema,
      scanRevision: revisionSchema,
      reviewRevision: revisionSchema,
    }),
    z.strictObject({
      kind: z.literal('progress'),
      jobId: SyncJobIdSchema,
      scanRevision: revisionSchema,
      step: z.number().int().min(0).max(20),
      candidateCount: z.number().int().min(0).max(50),
      existingObservationCount: z.number().int().min(0).max(1_000_000),
    }),
    z.strictObject({
      kind: z.literal('paused'),
      jobId: SyncJobIdSchema,
      scanRevision: revisionSchema,
      reason: stopReasonSchema,
    }),
  ]),
});

export type XSyncPortMessage = z.infer<typeof portMessageSchema>;

const contentLimitsSchema = z.strictObject({
  remainingCandidateSlots: z.number().int().min(0).max(50),
  maxObservedNodes: z.number().int().min(1).max(200),
  maxElapsedMs: z.number().int().min(1).max(15_000),
  maxTextBytes: z
    .number()
    .int()
    .min(1)
    .max(8 * 1_024),
  maxMedia: z.number().int().min(0).max(12),
  maxTotalBytes: z
    .number()
    .int()
    .min(1)
    .max(16 * 1_024 * 1_024),
  maxScrollActionsRemaining: z.number().int().min(0).max(20),
  allowScroll: z.boolean(),
});

const contentRequestBase = {
  protocol: z.literal(X_SYNC_PROTOCOL),
  jobId: SyncJobIdSchema,
  scanRevision: revisionSchema,
  adapterVersion: positiveVersionSchema,
  step: z.number().int().min(0).max(20),
  nonce: nonceSchema,
};

const contentRequestSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ ...contentRequestBase, type: z.literal('ping') }),
    z.strictObject({
      ...contentRequestBase,
      type: z.literal('read-batch'),
      mode: scanModeSchema,
      candidateSourceItemIds: z.array(XSourceItemIdSchema).max(X_SYNC_MESSAGE_LIMITS.selectedItems),
      knownFrontierSourceItemIds: z
        .array(XSourceItemIdSchema)
        .max(X_SYNC_MESSAGE_LIMITS.knownFrontierItems),
      limits: contentLimitsSchema,
    }),
  ])
  .superRefine((request, context) => {
    if (request.type !== 'read-batch') {
      return;
    }
    const sourceItemIds = [
      ...request.candidateSourceItemIds,
      ...request.knownFrontierSourceItemIds,
    ];
    if (new Set(sourceItemIds).size !== sourceItemIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Known X source item IDs must be unique across request groups',
      });
    }
  });

export type XSyncContentRequest = z.infer<typeof contentRequestSchema>;

const adapterCapabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('collection_scan'),
    source: z.literal('x'),
    adapterVersion: positiveVersionSchema,
  }),
  z.strictObject({ kind: z.literal('unsupported') }),
]);
const adapterSignalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('items') }),
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('terminal') }),
  z.strictObject({ kind: z.literal('no_progress'), stopReason: z.literal('no_progress') }),
  z.strictObject({
    kind: z.literal('challenge'),
    challenge: z.enum(['login_required', 'captcha', 'rate_limited']),
    stopReason: z.enum(['login_required', 'rate_limited']),
  }),
  z.strictObject({
    kind: z.literal('budget_exceeded'),
    budget: z.enum([
      'candidate_items',
      'accepted_bytes',
      'elapsed_time',
      'observed_nodes',
      'scroll_actions',
    ]),
    stopReason: z.literal('budget_exceeded'),
  }),
  z.strictObject({
    kind: z.literal('structure_changed'),
    stopReason: z.literal('structure_changed'),
  }),
  z.strictObject({ kind: z.literal('unsupported') }),
]);
const xSocialItemSchema = SocialItemSchema.refine((item) => item.source === 'x');
const adapterResultSchema = z
  .strictObject({
    capability: adapterCapabilitySchema,
    signal: adapterSignalSchema,
    items: z.array(xSocialItemSchema).max(50),
    identityOnlySourceItemIds: z.array(XSourceItemIdSchema).max(50).optional(),
    metrics: z.strictObject({
      observedNodes: z.number().int().min(0).max(200),
      acceptedItems: z.number().int().min(0).max(50),
      acceptedBytes: z
        .number()
        .int()
        .min(0)
        .max(16 * 1_024 * 1_024),
      elapsedMs: z.number().int().min(0).max(15_000),
    }),
  })
  .superRefine((result, context) => {
    const identityOnlySourceItemIds = result.identityOnlySourceItemIds ?? [];
    const itemBySourceItemId = new Map(result.items.map((item) => [item.sourceItemId, item]));
    if (
      new Set(identityOnlySourceItemIds).size !== identityOnlySourceItemIds.length ||
      identityOnlySourceItemIds.some((sourceItemId) => {
        const item = itemBySourceItemId.get(sourceItemId);
        return (
          !item ||
          item.completeness !== 'metadata_only' ||
          item.title !== undefined ||
          item.text !== undefined ||
          item.author?.displayName !== undefined ||
          item.publishedAt !== undefined ||
          item.media.length !== 0
        );
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Identity-only IDs must name unique metadata-only batch items',
      });
    }
    if (
      result.metrics.acceptedItems !== result.items.length ||
      result.metrics.observedNodes < result.items.length
    ) {
      context.addIssue({ code: 'custom', message: 'Adapter metrics do not match the item batch' });
    }
    if (result.signal.kind === 'items' && result.items.length === 0) {
      context.addIssue({ code: 'custom', message: 'An item signal requires at least one item' });
    }
    if (
      ['empty', 'no_progress', 'challenge', 'structure_changed', 'unsupported'].includes(
        result.signal.kind,
      ) &&
      result.items.length !== 0
    ) {
      context.addIssue({ code: 'custom', message: 'This signal cannot carry items' });
    }
  });

const contentResponseBase = {
  protocol: z.literal(X_SYNC_PROTOCOL),
  jobId: SyncJobIdSchema,
  scanRevision: revisionSchema,
  adapterVersion: positiveVersionSchema,
  step: z.number().int().min(0).max(20),
  nonce: nonceSchema,
  locationHref: z.literal(X_SYNC_BOOKMARKS_URL),
};
const contentResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...contentResponseBase, type: z.literal('pong') }),
  z.strictObject({
    ...contentResponseBase,
    type: z.literal('batch-result'),
    result: adapterResultSchema,
  }),
]);

export type XSyncContentResponse = z.infer<typeof contentResponseSchema>;

const launchIntentSchema = z
  .strictObject({
    protocol: z.literal(X_SYNC_PROTOCOL),
    action: z.literal('start'),
    windowId: windowIdSchema,
    createdAtMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expiresAtMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    nonce: nonceSchema,
  })
  .superRefine((intent, context) => {
    if (intent.expiresAtMs - intent.createdAtMs !== X_SYNC_LAUNCH_INTENT_TTL_MS) {
      context.addIssue({ code: 'custom', message: 'Launch intent TTL is invalid' });
    }
  });

export type XSyncLaunchIntent = z.infer<typeof launchIntentSchema>;
export type XSyncScanMode = z.infer<typeof scanModeSchema>;

const documentBindingSchema = z.strictObject({
  jobId: SyncJobIdSchema,
  scanRevision: revisionSchema,
  tabId: tabIdSchema,
  windowId: windowIdSchema,
  frameId: z.literal(0),
  documentId: documentIdSchema,
  exactUrl: z.literal(X_SYNC_BOOKMARKS_URL),
  nonce: nonceSchema,
});

export type XSyncDocumentBinding = z.infer<typeof documentBindingSchema>;

export function parseXSyncUiRequest(input: unknown): XSyncUiRequest {
  return parseBounded(input, uiRequestSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.uiBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.uiNodes,
  });
}

export function parseXSyncUiResponse(input: unknown): XSyncUiResponse {
  return parseBounded(input, uiResponseSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.uiBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.uiNodes,
  });
}

export function parseXSyncPortMessage(input: unknown): XSyncPortMessage {
  return parseBounded(input, portMessageSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.portBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.portNodes,
  });
}

export function parseXSyncContentRequest(input: unknown): XSyncContentRequest {
  return parseBounded(input, contentRequestSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.uiBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.uiNodes,
  });
}

export function parseXSyncContentResponse(input: unknown): XSyncContentResponse {
  return parseBounded(input, contentResponseSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.contentBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.contentNodes,
  });
}

export function parseXSyncLaunchIntent(input: unknown): XSyncLaunchIntent {
  return parseBounded(input, launchIntentSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.intentBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.intentNodes,
  });
}

export function parseXSyncDocumentBinding(input: unknown): XSyncDocumentBinding {
  return parseBounded(input, documentBindingSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.bindingBytes,
    maxDepth: X_SYNC_MESSAGE_LIMITS.maxDepth,
    maxNodes: X_SYNC_MESSAGE_LIMITS.bindingNodes,
  });
}

export function matchesXSyncContentResponseBinding(
  responseInput: unknown,
  bindingInput: unknown,
  expectedStep: number,
  expectedAdapterVersion: number,
): boolean {
  try {
    const response = parseXSyncContentResponse(responseInput);
    const binding = parseXSyncDocumentBinding(bindingInput);
    return (
      response.jobId === binding.jobId &&
      response.scanRevision === binding.scanRevision &&
      response.step === expectedStep &&
      response.adapterVersion === expectedAdapterVersion &&
      response.nonce === binding.nonce &&
      response.locationHref === binding.exactUrl
    );
  } catch {
    return false;
  }
}

interface ShallowRecord {
  readonly descriptors: PropertyDescriptorMap;
}

function inspectShallowRecord(value: unknown, maximumKeys: number): ShallowRecord | null {
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
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > maximumKeys) {
    return null;
  }
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_OBJECT_KEYS.has(key)) {
      return null;
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return null;
    }
  }
  return { descriptors };
}

function shallowValue(record: ShallowRecord, key: string): unknown {
  const descriptor = record.descriptors[key];
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export type XSyncSenderRejectionCode =
  | 'sender_uninspectable'
  | 'extension_id_mismatch'
  | 'extension_origin_mismatch'
  | 'sender_surface_mismatch'
  | 'sender_context_mismatch';

export type XSyncSenderValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: XSyncSenderRejectionCode };

export function resolveXSyncExtensionOrigin(
  extensionId: string,
  runtimeRootUrl: string,
): string | null {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    return null;
  }
  try {
    const parsed = new URL(runtimeRootUrl);
    if (
      parsed.protocol !== 'chrome-extension:' ||
      parsed.hostname !== extensionId ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== ''
    ) {
      return null;
    }
    return `chrome-extension://${extensionId}`;
  } catch {
    return null;
  }
}

export function validateXSyncUiSender(
  senderInput: unknown,
  extensionId: string,
  extensionOrigin: string,
): XSyncSenderValidation<{ readonly surface: 'popup' | 'sidepanel' }> {
  const sender = inspectShallowRecord(senderInput, 32);
  if (!sender) {
    return { ok: false, code: 'sender_uninspectable' };
  }
  if (shallowValue(sender, 'id') !== extensionId) {
    return { ok: false, code: 'extension_id_mismatch' };
  }
  const origin = shallowValue(sender, 'origin');
  if (origin !== undefined && origin !== extensionOrigin) {
    return { ok: false, code: 'extension_origin_mismatch' };
  }
  if (shallowValue(sender, 'tab') !== undefined) {
    return { ok: false, code: 'sender_context_mismatch' };
  }
  const url = shallowValue(sender, 'url');
  if (url === `${extensionOrigin}/popup/index.html`) {
    return { ok: true, value: { surface: 'popup' } };
  }
  if (url === `${extensionOrigin}/sidepanel/index.html`) {
    return { ok: true, value: { surface: 'sidepanel' } };
  }
  return { ok: false, code: 'sender_surface_mismatch' };
}

export function validateXSyncServiceWorkerSender(
  senderInput: unknown,
  extensionId: string,
  extensionOrigin: string,
): XSyncSenderValidation<{ readonly context: 'service-worker' }> {
  const sender = inspectShallowRecord(senderInput, 32);
  if (!sender) {
    return { ok: false, code: 'sender_uninspectable' };
  }
  if (shallowValue(sender, 'id') !== extensionId) {
    return { ok: false, code: 'extension_id_mismatch' };
  }
  if (shallowValue(sender, 'tab') !== undefined) {
    return { ok: false, code: 'sender_context_mismatch' };
  }
  const origin = shallowValue(sender, 'origin');
  if (origin !== undefined && origin !== extensionOrigin) {
    return { ok: false, code: 'extension_origin_mismatch' };
  }
  const url = shallowValue(sender, 'url');
  if (url !== undefined && url !== `${extensionOrigin}/background/service-worker.js`) {
    return { ok: false, code: 'sender_surface_mismatch' };
  }
  return { ok: true, value: { context: 'service-worker' } };
}

export function makeMinimalXSyncRuntimeError(input: {
  readonly code: XSyncMinimalRuntimeError['code'];
  readonly phase: XSyncMinimalRuntimeError['phase'];
  readonly jobId?: string;
  readonly scanRevision?: number;
}): XSyncMinimalRuntimeError {
  return parseBounded(input, minimalRuntimeErrorSchema, {
    maxBytes: X_SYNC_MESSAGE_LIMITS.bindingBytes,
    maxDepth: 2,
    maxNodes: 16,
  });
}
