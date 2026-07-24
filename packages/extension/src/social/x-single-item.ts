import { z } from 'zod';

import { cloneBoundedStructuredValue, StructuredInputError } from '../shared/extension-messages.js';
import {
  adaptXBookmarksObservation,
  X_BOOKMARKS_ADAPTER_VERSION,
  type XBookmarksDomObservation,
} from './adapters/x-bookmarks.js';
import {
  IsoTimestampSchema,
  SocialItemSchema,
  SYNC_LIMITS,
  type SocialItem,
  type SyncItemClassification,
  type SyncJob,
} from './sync-schema.js';
import {
  ActiveSyncJobExistsError,
  type ClassifyAndPersistScanBatchResult,
  type SyncStore,
} from './sync-store.js';

const textEncoder = new TextEncoder();
const X_STATUS_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,19})$/u;
const X_HANDLE_PATTERN = /^@?([A-Za-z0-9_]{1,15})$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/u;
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

export const X_SINGLE_PROTOCOL = 'shuhai-x-single-item' as const;
export const X_SINGLE_EXTRACT_PROTOCOL = 'shuhai-x-single-extract' as const;
export const X_SINGLE_RESPONSE_PROTOCOL = 'shuhai-x-single-extract-response' as const;
export const X_SINGLE_VERSION = 1 as const;

export const X_SINGLE_DIAGNOSTIC_CODES = [
  'route_invalid',
  'article_not_found',
  'article_ambiguous',
  'permalink_mismatch',
  'content_missing',
  'expansion_uncertain',
  'structure_changed',
  'payload_invalid',
  'payload_oversize',
] as const;

export const X_SINGLE_PROBE_NAMES = [
  'primary_article',
  'status_permalink',
  'tweet_text',
  'author',
  'timestamp',
] as const;

export type XSingleDiagnosticCode = (typeof X_SINGLE_DIAGNOSTIC_CODES)[number];
export type XSingleProbeName = (typeof X_SINGLE_PROBE_NAMES)[number];

export interface XStatusIdentity {
  readonly handle: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
}

export interface XSingleDiagnostic {
  readonly version: 1;
  readonly platform: 'x';
  readonly routeFamily: 'x/status';
  readonly errorCode: XSingleDiagnosticCode;
  readonly probes: ReadonlyArray<{
    readonly name: XSingleProbeName;
    readonly found: boolean;
  }>;
  readonly usedFallback: boolean;
}

export interface XSingleEnvelope {
  readonly protocol: typeof X_SINGLE_PROTOCOL;
  readonly version: 1;
  readonly routeFamily: 'x/status';
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
  readonly title?: string;
  readonly text?: string;
  readonly author: {
    readonly displayName?: string;
    readonly handle?: string;
  };
  readonly publishedAt?: string;
  readonly media: ReadonlyArray<{
    readonly type: 'image' | 'video' | 'link';
    readonly url: string;
    readonly alt?: string;
  }>;
  readonly contentKind: 'post' | 'unsupported';
  readonly diagnostic?: XSingleDiagnostic;
}

export interface XSingleExtractRequest {
  readonly protocol: typeof X_SINGLE_EXTRACT_PROTOCOL;
  readonly version: 1;
  readonly type: 'xSingle:extract';
  readonly requestId: string;
  readonly canonicalUrl: string;
  readonly sourceItemId: string;
}

export type XSingleExtractResponse =
  | {
      readonly protocol: typeof X_SINGLE_RESPONSE_PROTOCOL;
      readonly version: 1;
      readonly requestId: string;
      readonly ok: true;
      readonly item: XSingleEnvelope;
    }
  | {
      readonly protocol: typeof X_SINGLE_RESPONSE_PROTOCOL;
      readonly version: 1;
      readonly requestId: string;
      readonly ok: false;
      readonly diagnostic: XSingleDiagnostic;
    };

export interface XSingleJobResult {
  readonly job: SyncJob;
  readonly item: SocialItem;
  readonly classification: Exclude<SyncItemClassification, 'pending'>;
  readonly noWriteCandidate: boolean;
}

const X_SINGLE_STRUCTURE_LIMITS = Object.freeze({
  maxBytes: SYNC_LIMITS.socialItemBytes,
  maxDepth: SYNC_LIMITS.structuredDepth,
  maxNodes: SYNC_LIMITS.structuredNodes,
  maxStringBytes: 12 * 1_024,
});

function byteBoundedText(maxBytes: number, minimumBytes = 0) {
  return z.string().refine((value) => {
    const bytes = textEncoder.encode(value).byteLength;
    return bytes >= minimumBytes && bytes <= maxBytes;
  });
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function canonicalMediaUrl(value: string): string | undefined {
  if (
    value !== value.trim() ||
    value.includes('\\') ||
    containsControlCharacters(value) ||
    textEncoder.encode(value).byteLength > SYNC_LIMITS.canonicalUrlBytes
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return undefined;
    }
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function canonicalizeXStatusUrl(value: unknown): XStatusIdentity | undefined {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.includes('\\') ||
    containsControlCharacters(value) ||
    textEncoder.encode(value).byteLength > SYNC_LIMITS.canonicalUrlBytes
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== 'https://x.com' ||
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'x.com' ||
      parsed.username ||
      parsed.password ||
      (parsed.port !== '' && parsed.port !== '443')
    ) {
      return undefined;
    }
    const match = X_STATUS_PATH_PATTERN.exec(parsed.pathname);
    if (!match) {
      return undefined;
    }
    const handle = match[1]?.toLowerCase();
    const sourceItemId = match[2];
    if (!handle || !sourceItemId) {
      return undefined;
    }
    return {
      handle,
      sourceItemId,
      canonicalUrl: `https://x.com/${handle}/status/${sourceItemId}`,
    };
  } catch {
    return undefined;
  }
}

const probeSchema = z.strictObject({
  name: z.enum(X_SINGLE_PROBE_NAMES),
  found: z.boolean(),
});

const diagnosticSchema: z.ZodType<XSingleDiagnostic> = z
  .strictObject({
    version: z.literal(X_SINGLE_VERSION),
    platform: z.literal('x'),
    routeFamily: z.literal('x/status'),
    errorCode: z.enum(X_SINGLE_DIAGNOSTIC_CODES),
    probes: z.array(probeSchema).max(X_SINGLE_PROBE_NAMES.length),
    usedFallback: z.boolean(),
  })
  .superRefine((value, context) => {
    const names = value.probes.map((probe) => probe.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', path: ['probes'], message: 'Duplicate probe' });
    }
  });

const mediaSchema = z.strictObject({
  type: z.enum(['image', 'video', 'link']),
  url: byteBoundedText(SYNC_LIMITS.canonicalUrlBytes, 1),
  alt: byteBoundedText(SYNC_LIMITS.mediaAltBytes).optional(),
});

const envelopeSchema: z.ZodType<XSingleEnvelope> = z
  .strictObject({
    protocol: z.literal(X_SINGLE_PROTOCOL),
    version: z.literal(X_SINGLE_VERSION),
    routeFamily: z.literal('x/status'),
    sourceItemId: z.string().regex(/^\d{1,19}$/u),
    canonicalUrl: byteBoundedText(SYNC_LIMITS.canonicalUrlBytes, 1),
    title: byteBoundedText(SYNC_LIMITS.titleBytes).optional(),
    text: byteBoundedText(SYNC_LIMITS.textBytes).optional(),
    author: z.strictObject({
      displayName: byteBoundedText(SYNC_LIMITS.authorDisplayNameBytes).optional(),
      handle: byteBoundedText(SYNC_LIMITS.authorHandleBytes).optional(),
    }),
    publishedAt: IsoTimestampSchema.optional(),
    media: z.array(mediaSchema).max(SYNC_LIMITS.mediaItems),
    contentKind: z.enum(['post', 'unsupported']),
    diagnostic: diagnosticSchema.optional(),
  })
  .superRefine((value, context) => {
    const identity = canonicalizeXStatusUrl(value.canonicalUrl);
    if (!identity || identity.sourceItemId !== value.sourceItemId) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalUrl'],
        message: 'X item identity mismatch',
      });
      return;
    }
    if (value.author.handle) {
      const handle = X_HANDLE_PATTERN.exec(value.author.handle)?.[1];
      if (!handle || handle.toLowerCase() !== identity.handle.toLowerCase()) {
        context.addIssue({
          code: 'custom',
          path: ['author', 'handle'],
          message: 'X author identity mismatch',
        });
      }
    }
    if (value.contentKind === 'post' && !value.text?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Post content requires text',
      });
    }
    const mediaKeys = new Set<string>();
    for (let index = 0; index < value.media.length; index += 1) {
      const media = value.media[index];
      const canonical = canonicalMediaUrl(media.url);
      if (!canonical) {
        context.addIssue({
          code: 'custom',
          path: ['media', index, 'url'],
          message: 'Invalid media URL',
        });
        continue;
      }
      const key = `${media.type}\u0000${canonical}`;
      if (mediaKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['media', index],
          message: 'Duplicate media',
        });
      }
      mediaKeys.add(key);
    }
  });

const extractRequestSchema: z.ZodType<XSingleExtractRequest> = z.strictObject({
  protocol: z.literal(X_SINGLE_EXTRACT_PROTOCOL),
  version: z.literal(X_SINGLE_VERSION),
  type: z.literal('xSingle:extract'),
  requestId: z.string().regex(REQUEST_ID_PATTERN),
  canonicalUrl: byteBoundedText(SYNC_LIMITS.canonicalUrlBytes, 1),
  sourceItemId: z.string().regex(/^\d{1,19}$/u),
});

const extractResponseSchema: z.ZodType<XSingleExtractResponse> = z.discriminatedUnion('ok', [
  z.strictObject({
    protocol: z.literal(X_SINGLE_RESPONSE_PROTOCOL),
    version: z.literal(X_SINGLE_VERSION),
    requestId: z.string().regex(REQUEST_ID_PATTERN),
    ok: z.literal(true),
    item: envelopeSchema,
  }),
  z.strictObject({
    protocol: z.literal(X_SINGLE_RESPONSE_PROTOCOL),
    version: z.literal(X_SINGLE_VERSION),
    requestId: z.string().regex(REQUEST_ID_PATTERN),
    ok: z.literal(false),
    diagnostic: diagnosticSchema,
  }),
]);

function parseBounded<T>(schema: z.ZodType<T>, value: unknown): T {
  const clone = cloneBoundedStructuredValue(value, X_SINGLE_STRUCTURE_LIMITS);
  const parsed = schema.safeParse(clone);
  if (!parsed.success) {
    throw new StructuredInputError('invalid_message');
  }
  return parsed.data;
}

export function parseXSingleDiagnostic(value: unknown): XSingleDiagnostic {
  return parseBounded(diagnosticSchema, value);
}

export function parseXSingleEnvelope(value: unknown): XSingleEnvelope {
  const parsed = parseBounded(envelopeSchema, value);
  const identity = canonicalizeXStatusUrl(parsed.canonicalUrl);
  if (!identity) {
    throw new StructuredInputError('invalid_message');
  }
  return {
    ...parsed,
    canonicalUrl: identity.canonicalUrl,
    media: parsed.media.map((media) => ({
      ...media,
      url: canonicalMediaUrl(media.url)!,
    })),
  };
}

export function parseXSingleExtractRequest(value: unknown): XSingleExtractRequest {
  const parsed = parseBounded(extractRequestSchema, value);
  const identity = canonicalizeXStatusUrl(parsed.canonicalUrl);
  if (!identity || identity.sourceItemId !== parsed.sourceItemId) {
    throw new StructuredInputError('invalid_message');
  }
  return { ...parsed, canonicalUrl: identity.canonicalUrl };
}

export function parseXSingleExtractResponse(value: unknown): XSingleExtractResponse {
  const parsed = parseBounded(extractResponseSchema, value);
  return parsed.ok ? { ...parsed, item: parseXSingleEnvelope(parsed.item) } : parsed;
}

export function createXSingleDiagnostic(
  errorCode: XSingleDiagnosticCode,
  probes: ReadonlyArray<{ readonly name: XSingleProbeName; readonly found: boolean }>,
  usedFallback = false,
): XSingleDiagnostic {
  return parseXSingleDiagnostic({
    version: X_SINGLE_VERSION,
    platform: 'x',
    routeFamily: 'x/status',
    errorCode,
    probes,
    usedFallback,
  });
}

export async function adaptXSingleEnvelope(
  envelopeInput: unknown,
  expectedIdentity: XStatusIdentity,
  capturedAt: string,
): Promise<SocialItem> {
  const envelope = parseXSingleEnvelope(envelopeInput);
  const identity = canonicalizeXStatusUrl(envelope.canonicalUrl);
  if (
    !identity ||
    identity.canonicalUrl !== expectedIdentity.canonicalUrl ||
    identity.sourceItemId !== expectedIdentity.sourceItemId
  ) {
    throw new StructuredInputError('invalid_message');
  }

  const observation: XBookmarksDomObservation = {
    pageUrl: 'https://x.com/i/bookmarks',
    signal: { kind: 'terminal' },
    observedNodeCount: 1,
    entries: [
      {
        permalink: expectedIdentity.canonicalUrl,
        ...(envelope.title === undefined ? {} : { title: envelope.title }),
        ...(envelope.text === undefined ? {} : { text: envelope.text }),
        author: envelope.author,
        ...(envelope.publishedAt === undefined ? {} : { publishedAt: envelope.publishedAt }),
        media: envelope.media,
        contentKind: envelope.contentKind,
      },
    ],
  };
  const batch = await adaptXBookmarksObservation(observation, {
    capturedAt: IsoTimestampSchema.parse(capturedAt),
    remainingCandidateSlots: 1,
    limits: {
      maxItems: 1,
      maxBatches: 1,
      maxScrollActions: 1,
      maxObservedNodes: 1,
      maxElapsedMs: 30_000,
      maxTextBytes: SYNC_LIMITS.textBytes,
      maxMedia: SYNC_LIMITS.mediaItems,
      maxTotalBytes: SYNC_LIMITS.socialItemBytes,
      maxCheckpointBytes: SYNC_LIMITS.checkpointBytes,
      maxConsecutiveStructureErrors: 1,
    },
  });
  if (
    batch.capability.kind !== 'collection_scan' ||
    batch.signal.kind !== 'terminal' ||
    batch.metrics.observedNodes !== 1 ||
    batch.items.length !== 1 ||
    (batch.identityOnlySourceItemIds?.length ?? 0) !== 0
  ) {
    throw new StructuredInputError('invalid_message');
  }
  return SocialItemSchema.parse(batch.items[0]);
}

function classificationFor(
  result: ClassifyAndPersistScanBatchResult,
  sourceItemId: string,
): Exclude<SyncItemClassification, 'pending'> {
  const classification = result.classifications.find(
    (candidate) => candidate.sourceItemId === sourceItemId,
  )?.classification;
  if (!classification) {
    throw new Error('x_single_classification_failed');
  }
  return classification;
}

export async function createXSingleSyncJob(
  store: SyncStore,
  envelopeInput: unknown,
  expectedIdentity: XStatusIdentity,
  options: {
    readonly jobId?: string;
    readonly now?: () => string;
  } = {},
): Promise<XSingleJobResult> {
  if (await store.getActiveJob('x')) {
    throw new ActiveSyncJobExistsError('x');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const capturedAt = IsoTimestampSchema.parse(now());
  const item = await adaptXSingleEnvelope(envelopeInput, expectedIdentity, capturedAt);
  let randomId = options.jobId;
  if (!randomId) {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (!uuid) {
      throw new Error('x_single_job_id_unavailable');
    }
    randomId = `x-single-${uuid}`;
  }
  if (!SAFE_JOB_ID_PATTERN.test(randomId)) {
    throw new Error('x_single_job_id_unavailable');
  }

  const prepared = await store.createJob({
    id: randomId,
    source: 'x',
    adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
    scanMode: 'incremental',
    budgets: {
      maxItems: 1,
      maxPages: 1,
      maxDurationMs: 30_000,
      maxItemBytes: SYNC_LIMITS.socialItemBytes,
      maxMediaPerItem: SYNC_LIMITS.mediaItems,
    },
    createdAt: capturedAt,
  });
  const scanning = await store.claimScanRevision(prepared.id, prepared.scanRevision, now());
  const classified = await store.classifyAndPersistScanBatch(
    prepared.id,
    scanning.scanRevision,
    [item],
    1,
    now(),
  );
  const job = await store.finishScan(prepared.id, scanning.scanRevision, now(), {
    scanCompletion: 'trusted_terminal',
  });
  const classification = classificationFor(classified, item.sourceItemId);
  return {
    job,
    item,
    classification,
    noWriteCandidate: job.summary.uniqueItemCount === 0,
  };
}
