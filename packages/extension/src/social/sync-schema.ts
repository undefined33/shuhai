import { z } from 'zod';

const textEncoder = new TextEncoder();
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const WINDOWS_RESERVED_SEGMENT =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const X_SOURCE_ITEM_ID_PATTERN = /^\d{1,19}$/u;
const WEIBO_SOURCE_ITEM_ID_PATTERN = /^[A-Za-z0-9]{6,32}$/u;

export const SYNC_SCHEMA_VERSION = 1 as const;

export const SYNC_LIMITS = {
  sourceItemIdBytes: 256,
  jobIdBytes: 128,
  intentIdBytes: 64,
  canonicalUrlBytes: 2_048,
  titleBytes: 1_024,
  textBytes: 8 * 1_024,
  authorDisplayNameBytes: 512,
  authorHandleBytes: 256,
  mediaAltBytes: 1_024,
  mediaItems: 12,
  contentHashBytes: 64,
  relativePathBytes: 512,
  relativePathSegmentBytes: 120,
  cursorBytes: 2_048,
  errorCodeBytes: 64,
  outcomeReasonBytes: 256,
  socialItemBytes: 64 * 1_024,
  persistedRowBytes: 96 * 1_024,
  structuredDepth: 6,
  structuredNodes: 2_048,
  maxItemsPerJob: 10_000,
  maxCatalogBatch: 10_000,
} as const;

interface StructuredInputLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}

interface StructuredInputProblem {
  path: PropertyKey[];
  message: string;
}

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).byteLength;
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

function inspectStructuredInput(
  input: unknown,
  limits: StructuredInputLimits,
): StructuredInputProblem | undefined {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; path: PropertyKey[] }> = [
    { value: input, depth: 0, path: [] },
  ];
  let bytes = 0;
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      return { path: current.path, message: 'Structured input has too many values' };
    }

    const value = current.value;
    if (value === null) {
      bytes += 4;
    } else if (typeof value === 'string') {
      bytes += utf8Bytes(value);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return { path: current.path, message: 'Structured input contains a non-finite number' };
      }
      bytes += 8;
    } else if (typeof value === 'boolean') {
      bytes += 1;
    } else if (typeof value !== 'object') {
      return { path: current.path, message: 'Structured input contains an unsupported value' };
    } else {
      if (current.depth > limits.maxDepth) {
        return { path: current.path, message: 'Structured input exceeds the depth limit' };
      }
      if (seen.has(value)) {
        return { path: current.path, message: 'Structured input must not be cyclic' };
      }
      seen.add(value);

      let arrayValue: boolean;
      try {
        arrayValue = Array.isArray(value);
      } catch {
        return { path: current.path, message: 'Structured input could not be inspected' };
      }

      if (arrayValue) {
        let prototype: object | null;
        let keys: string[];
        let length: number;
        try {
          prototype = Object.getPrototypeOf(value);
          keys = Object.keys(value);
          length = (value as unknown[]).length;
        } catch {
          return { path: current.path, message: 'Array properties could not be inspected' };
        }
        if (prototype !== Array.prototype) {
          return { path: current.path, message: 'Array prototypes are not allowed' };
        }
        if (keys.length !== length) {
          return {
            path: current.path,
            message: 'Sparse arrays and extra array keys are not allowed',
          };
        }
        for (let index = 0; index < length; index += 1) {
          if (keys[index] !== String(index)) {
            return {
              path: [...current.path, keys[index] ?? index],
              message: 'Sparse arrays and extra array keys are not allowed',
            };
          }
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          } catch {
            return {
              path: [...current.path, index],
              message: 'Array properties could not be inspected',
            };
          }
          if (!descriptor || !('value' in descriptor)) {
            return {
              path: [...current.path, index],
              message: 'Accessor properties are not allowed',
            };
          }
          stack.push({
            value: descriptor.value,
            depth: current.depth + 1,
            path: [...current.path, index],
          });
        }
      } else {
        let prototype: object | null;
        try {
          prototype = Object.getPrototypeOf(value);
        } catch {
          return { path: current.path, message: 'Object prototype could not be inspected' };
        }
        if (prototype !== Object.prototype && prototype !== null) {
          return { path: current.path, message: 'Custom object prototypes are not allowed' };
        }

        let descriptors: PropertyDescriptorMap;
        try {
          descriptors = Object.getOwnPropertyDescriptors(value);
        } catch {
          return { path: current.path, message: 'Object properties could not be inspected' };
        }

        for (const key of Reflect.ownKeys(descriptors)) {
          if (typeof key !== 'string') {
            return { path: [...current.path, key], message: 'Symbol keys are not allowed' };
          }
          if (FORBIDDEN_OBJECT_KEYS.has(key)) {
            return {
              path: [...current.path, key],
              message: 'Prototype mutation keys are not allowed',
            };
          }
          const descriptor = descriptors[key];
          if (!descriptor?.enumerable || !('value' in descriptor)) {
            return {
              path: [...current.path, key],
              message: 'Hidden and accessor properties are not allowed',
            };
          }
          bytes += utf8Bytes(key);
          stack.push({
            value: descriptor.value,
            depth: current.depth + 1,
            path: [...current.path, key],
          });
        }
      }
    }

    if (bytes > limits.maxBytes) {
      return { path: current.path, message: 'Structured input exceeds the byte limit' };
    }
  }

  return undefined;
}

function budgetedSchema<T extends z.ZodType>(
  schema: T,
  limits: StructuredInputLimits,
): z.ZodPipe<z.ZodAny, T> {
  return z
    .any()
    .superRefine((value: unknown, context) => {
      const problem = inspectStructuredInput(value, limits);
      if (problem) {
        context.addIssue({
          code: 'custom',
          path: problem.path,
          message: problem.message,
        });
      }
    })
    .pipe(schema);
}

function boundedString(maxBytes: number, minimumBytes = 0): z.ZodString {
  return z
    .string()
    .max(maxBytes)
    .refine((value) => utf8Bytes(value) >= minimumBytes, {
      message: `String must contain at least ${minimumBytes} UTF-8 byte(s)`,
    })
    .refine((value) => utf8Bytes(value) <= maxBytes, {
      message: `String must not exceed ${maxBytes} UTF-8 bytes`,
    });
}

function isValidIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) {
    return false;
  }

  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

function isSafeHttpsUrl(value: string): boolean {
  if (value !== value.trim() || value.includes('\\') || hasControlCharacters(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname !== ''
    );
  } catch {
    return false;
  }
}

function isSafeIdentifier(value: string): boolean {
  return value === value.trim() && !hasControlCharacters(value);
}

function canonicalUrlMatchesSource(
  source: 'x' | 'weibo',
  sourceItemId: string,
  canonicalUrl: string,
): boolean {
  if (!canonicalUrl.startsWith('https://')) {
    return false;
  }
  const authorityEnd = canonicalUrl.indexOf('/', 'https://'.length);
  const authority = canonicalUrl.slice(
    'https://'.length,
    authorityEnd === -1 ? canonicalUrl.length : authorityEnd,
  );
  if (authority.includes(':')) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(canonicalUrl);
  } catch {
    return false;
  }
  if (authority !== parsed.hostname) {
    return false;
  }
  if (parsed.port !== '' || parsed.search !== '' || parsed.hash !== '') {
    return false;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (parsed.pathname !== `/${segments.join('/')}`) {
    return false;
  }

  if (source === 'x') {
    const isXHost = ['x.com', 'twitter.com', 'www.twitter.com'].includes(parsed.hostname);
    return (
      isXHost && segments.length === 3 && segments[1] === 'status' && segments[2] === sourceItemId
    );
  }

  const isWeiboHost = ['weibo.com', 'www.weibo.com', 'm.weibo.cn'].includes(parsed.hostname);
  const finalSegment = segments.at(-1);
  const precedingSegment = segments.at(-2);
  const knownPermalinkShape =
    precedingSegment === 'detail' ||
    precedingSegment === 'status' ||
    (segments.length === 2 && precedingSegment !== undefined);
  return isWeiboHost && knownPermalinkShape && finalSegment === sourceItemId;
}

function validateSourceIdentity(
  value: { source: 'x' | 'weibo'; sourceItemId: string; canonicalUrl: string },
  context: z.RefinementCtx,
): void {
  const sourceItemIdIsValid =
    value.source === 'x'
      ? X_SOURCE_ITEM_ID_PATTERN.test(value.sourceItemId)
      : WEIBO_SOURCE_ITEM_ID_PATTERN.test(value.sourceItemId);
  if (!sourceItemIdIsValid) {
    context.addIssue({
      code: 'custom',
      path: ['sourceItemId'],
      message:
        value.source === 'x'
          ? 'X sourceItemId must contain 1-19 decimal digits'
          : 'Weibo sourceItemId must contain 6-32 ASCII letters or digits',
    });
    return;
  }

  if (!canonicalUrlMatchesSource(value.source, value.sourceItemId, value.canonicalUrl)) {
    context.addIssue({
      code: 'custom',
      path: ['canonicalUrl'],
      message: 'canonicalUrl host and path must identify the source item',
    });
  }
}

function isSafeRelativeMarkdownPath(value: string): boolean {
  if (
    value !== value.normalize('NFC') ||
    value !== value.normalize('NFKC') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    !value.toLowerCase().endsWith('.md')
  ) {
    return false;
  }

  const segments = value.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      utf8Bytes(segment) <= SYNC_LIMITS.relativePathSegmentBytes &&
      !hasControlCharacters(segment) &&
      !/[<>:"|?*]/u.test(segment) &&
      !/[. ]$/u.test(segment) &&
      !WINDOWS_RESERVED_SEGMENT.test(segment),
  );
}

function timestampMillis(value: string): number {
  return Date.parse(value);
}

function expectedSyncJobItemKey(jobId: string, sourceItemId: string): string {
  return `${jobId.length}:${jobId}:${sourceItemId}`;
}

const persistedInputLimits: StructuredInputLimits = {
  maxBytes: SYNC_LIMITS.persistedRowBytes,
  maxDepth: SYNC_LIMITS.structuredDepth,
  maxNodes: SYNC_LIMITS.structuredNodes,
};

const countSchema = z.number().int().min(0).max(1_000_000);
const positiveVersionSchema = z.number().int().min(1).max(1_000_000);
export const SourceItemIdSchema = boundedString(SYNC_LIMITS.sourceItemIdBytes, 1).refine(
  isSafeIdentifier,
  'Identifier must be trimmed and contain no control characters',
);
export const XSourceItemIdSchema = SourceItemIdSchema.refine(
  (value) => X_SOURCE_ITEM_ID_PATTERN.test(value),
  'X sourceItemId must contain 1-19 decimal digits',
);
export const WeiboSourceItemIdSchema = SourceItemIdSchema.refine(
  (value) => WEIBO_SOURCE_ITEM_ID_PATTERN.test(value),
  'Weibo sourceItemId must contain 6-32 ASCII letters or digits',
);
export const SyncJobIdSchema = boundedString(SYNC_LIMITS.jobIdBytes, 1).refine(
  isSafeIdentifier,
  'Job ID must be trimmed and contain no control characters',
);
export const WriteIntentIdSchema = boundedString(SYNC_LIMITS.intentIdBytes, 1)
  .refine(isSafeIdentifier, 'Intent ID must be trimmed and contain no control characters')
  .regex(/^[A-Za-z0-9_-]+$/u, 'Intent ID must be a safe ASCII path token');

export const SocialSourceSchema = z.enum(['x', 'weibo']);
export type SocialSource = z.infer<typeof SocialSourceSchema>;

export const CaptureCompletenessSchema = z.enum([
  'complete',
  'summary_only',
  'metadata_only',
  'unsupported',
]);
export type CaptureCompleteness = z.infer<typeof CaptureCompletenessSchema>;

export const IsoTimestampSchema = boundedString(35, 20).refine(
  isValidIsoTimestamp,
  'Expected a valid ISO 8601 timestamp with Z or an explicit offset',
);
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export const HttpsUrlSchema = boundedString(SYNC_LIMITS.canonicalUrlBytes, 1).refine(
  isSafeHttpsUrl,
  'Expected an https URL without credentials or control characters',
);

export const ContentHashSchema = z
  .string()
  .length(SYNC_LIMITS.contentHashBytes)
  .regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 hex digest');

export const RelativeMarkdownPathSchema = boundedString(SYNC_LIMITS.relativePathBytes, 4).refine(
  isSafeRelativeMarkdownPath,
  'Expected a safe normalized relative Markdown path',
);

const authorSchema = z.strictObject({
  displayName: boundedString(SYNC_LIMITS.authorDisplayNameBytes, 1).optional(),
  handle: boundedString(SYNC_LIMITS.authorHandleBytes, 1).optional(),
});

export const RemoteMediaSchema = z.strictObject({
  type: z.enum(['image', 'video', 'link']),
  url: HttpsUrlSchema,
  alt: boundedString(SYNC_LIMITS.mediaAltBytes).optional(),
});
export type RemoteMedia = z.infer<typeof RemoteMediaSchema>;

const socialItemObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    source: SocialSourceSchema,
    sourceItemId: SourceItemIdSchema,
    canonicalUrl: HttpsUrlSchema,
    title: boundedString(SYNC_LIMITS.titleBytes).optional(),
    text: boundedString(SYNC_LIMITS.textBytes).optional(),
    author: authorSchema.optional(),
    publishedAt: IsoTimestampSchema.optional(),
    capturedAt: IsoTimestampSchema,
    completeness: CaptureCompletenessSchema,
    media: z.array(RemoteMediaSchema).max(SYNC_LIMITS.mediaItems),
    contentHash: ContentHashSchema,
    extractorVersion: positiveVersionSchema,
  })
  .superRefine(validateSourceIdentity);

export const SocialItemSchema = budgetedSchema(socialItemObjectSchema, {
  maxBytes: SYNC_LIMITS.socialItemBytes,
  maxDepth: 4,
  maxNodes: 256,
});
export type SocialItem = z.infer<typeof SocialItemSchema>;

export const SyncJobStatusSchema = z.enum([
  'prepared',
  'scanning',
  'paused',
  'ready_for_review',
  'writing',
  'partial',
  'complete',
  'failed',
  'cancelled',
]);
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>;

export const ACTIVE_SYNC_JOB_STATUSES: ReadonlySet<SyncJobStatus> = new Set([
  'prepared',
  'scanning',
  'paused',
  'ready_for_review',
  'writing',
  'partial',
]);

export const SyncBudgetsSchema = budgetedSchema(
  z.strictObject({
    maxItems: z.number().int().min(1).max(SYNC_LIMITS.maxItemsPerJob),
    maxPages: z.number().int().min(1).max(1_000),
    maxDurationMs: z.number().int().min(1).max(3_600_000),
    maxItemBytes: z.number().int().min(1).max(SYNC_LIMITS.socialItemBytes),
    maxMediaPerItem: z.number().int().min(0).max(SYNC_LIMITS.mediaItems),
  }),
  persistedInputLimits,
);
export type SyncBudgets = z.infer<typeof SyncBudgetsSchema>;

const syncCheckpointObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    adapterVersion: positiveVersionSchema,
    scannedCount: countSchema,
    acceptedCount: countSchema,
    consecutiveKnownIds: countSchema,
    cursor: boundedString(SYNC_LIMITS.cursorBytes, 1).refine(isSafeIdentifier).optional(),
    updatedAt: IsoTimestampSchema,
  })
  .superRefine((checkpoint, context) => {
    if (checkpoint.acceptedCount > checkpoint.scannedCount) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedCount'],
        message: 'acceptedCount cannot exceed scannedCount',
      });
    }
    if (checkpoint.consecutiveKnownIds > checkpoint.scannedCount) {
      context.addIssue({
        code: 'custom',
        path: ['consecutiveKnownIds'],
        message: 'consecutiveKnownIds cannot exceed scannedCount',
      });
    }
  });
export const SyncCheckpointSchema = budgetedSchema(
  syncCheckpointObjectSchema,
  persistedInputLimits,
);
export type SyncCheckpoint = z.infer<typeof SyncCheckpointSchema>;

export const SyncJobSummarySchema = z
  .strictObject({
    scannedCount: countSchema,
    uniqueItemCount: countSchema,
    pendingReviewCount: countSchema,
    writePendingCount: countSchema,
    createdCount: countSchema,
    alreadyExistsCount: countSchema,
    skippedCount: countSchema,
    errorCount: countSchema,
  })
  .superRefine((summary, context) => {
    if (summary.uniqueItemCount > summary.scannedCount) {
      context.addIssue({
        code: 'custom',
        path: ['uniqueItemCount'],
        message: 'uniqueItemCount cannot exceed scannedCount',
      });
    }
    if (summary.pendingReviewCount > summary.uniqueItemCount) {
      context.addIssue({
        code: 'custom',
        path: ['pendingReviewCount'],
        message: 'pendingReviewCount cannot exceed uniqueItemCount',
      });
    }
    const accountedItemCount =
      summary.pendingReviewCount +
      summary.writePendingCount +
      summary.createdCount +
      summary.alreadyExistsCount +
      summary.skippedCount +
      summary.errorCount;
    if (accountedItemCount > summary.uniqueItemCount) {
      context.addIssue({
        code: 'custom',
        path: ['uniqueItemCount'],
        message: 'Pending, write, and error counts cannot exceed uniqueItemCount',
      });
    }
  });
export type SyncJobSummary = z.infer<typeof SyncJobSummarySchema>;

export const EMPTY_SYNC_JOB_SUMMARY: Readonly<SyncJobSummary> = Object.freeze({
  scannedCount: 0,
  uniqueItemCount: 0,
  pendingReviewCount: 0,
  writePendingCount: 0,
  createdCount: 0,
  alreadyExistsCount: 0,
  skippedCount: 0,
  errorCount: 0,
});

const syncJobShape = {
  schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
  id: SyncJobIdSchema,
  source: SocialSourceSchema,
  status: SyncJobStatusSchema,
  adapterVersion: positiveVersionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  writeAuthorizedAt: IsoTimestampSchema.optional(),
  checkpoint: SyncCheckpointSchema.optional(),
  budgets: SyncBudgetsSchema,
  summary: SyncJobSummarySchema,
};

function validateSyncJob(
  job: z.infer<z.ZodObject<typeof syncJobShape>>,
  context: z.RefinementCtx,
): void {
  if (timestampMillis(job.updatedAt) < timestampMillis(job.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'updatedAt cannot precede createdAt',
    });
  }
  if (
    job.writeAuthorizedAt &&
    (timestampMillis(job.writeAuthorizedAt) < timestampMillis(job.createdAt) ||
      timestampMillis(job.writeAuthorizedAt) > timestampMillis(job.updatedAt))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['writeAuthorizedAt'],
      message: 'writeAuthorizedAt must fall within the job lifetime',
    });
  }
  const requiresWriteAuthorization = ['writing', 'partial', 'complete'].includes(job.status);
  if (requiresWriteAuthorization && !job.writeAuthorizedAt) {
    context.addIssue({
      code: 'custom',
      path: ['writeAuthorizedAt'],
      message: 'Writing and completed jobs require explicit write authorization',
    });
  }
  if (
    ['prepared', 'scanning', 'ready_for_review'].includes(job.status) &&
    job.writeAuthorizedAt !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['writeAuthorizedAt'],
      message: 'A job cannot be write-authorized before review is complete',
    });
  }
  if (job.checkpoint && job.checkpoint.adapterVersion !== job.adapterVersion) {
    context.addIssue({
      code: 'custom',
      path: ['checkpoint', 'adapterVersion'],
      message: 'Checkpoint adapterVersion must match the job adapterVersion',
    });
  }
  if (job.summary.uniqueItemCount > job.budgets.maxItems) {
    context.addIssue({
      code: 'custom',
      path: ['summary', 'uniqueItemCount'],
      message: 'uniqueItemCount cannot exceed the job item budget',
    });
  }
  if (job.checkpoint) {
    if (timestampMillis(job.checkpoint.updatedAt) > timestampMillis(job.updatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['checkpoint', 'updatedAt'],
        message: 'Checkpoint cannot be newer than its job',
      });
    }
    if (job.summary.scannedCount !== job.checkpoint.scannedCount) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'scannedCount'],
        message: 'Job and checkpoint scanned counts must match',
      });
    }
    if (job.summary.uniqueItemCount > job.checkpoint.acceptedCount) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'uniqueItemCount'],
        message: 'Persisted unique items must be covered by the checkpoint',
      });
    }
  } else if (job.summary.scannedCount !== 0 || job.summary.uniqueItemCount !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['checkpoint'],
      message: 'A job with scan results must retain its checkpoint',
    });
  }
  if (
    job.status === 'complete' &&
    (job.summary.pendingReviewCount !== 0 ||
      job.summary.writePendingCount !== 0 ||
      job.summary.errorCount !== 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'A complete job cannot retain pending or error counts',
    });
  }
  if (
    job.status === 'complete' &&
    job.summary.createdCount + job.summary.alreadyExistsCount + job.summary.skippedCount !==
      job.summary.uniqueItemCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'A complete job must account for every unique item',
    });
  }
}

const syncJobObjectSchema = z.strictObject(syncJobShape).superRefine(validateSyncJob);
export const SyncJobSchema = budgetedSchema(syncJobObjectSchema, persistedInputLimits);
export type SyncJob = z.infer<typeof SyncJobSchema>;

const syncJobRowObjectSchema = z
  .strictObject({
    ...syncJobShape,
    activeSource: SocialSourceSchema.optional(),
  })
  .superRefine((job, context) => {
    validateSyncJob(job, context);
    const isActive = ACTIVE_SYNC_JOB_STATUSES.has(job.status);
    if (isActive && job.activeSource !== job.source) {
      context.addIssue({
        code: 'custom',
        path: ['activeSource'],
        message: 'Active jobs must index their source',
      });
    }
    if (!isActive && job.activeSource !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['activeSource'],
        message: 'Terminal jobs must not retain an active source index',
      });
    }
  });
export const SyncJobRowSchema = budgetedSchema(syncJobRowObjectSchema, persistedInputLimits);
export type SyncJobRow = z.infer<typeof SyncJobRowSchema>;

export const SyncItemClassificationSchema = z.enum([
  'pending',
  'new',
  'existing',
  'changed',
  'incomplete',
  'error',
]);
export type SyncItemClassification = z.infer<typeof SyncItemClassificationSchema>;

export const WriteOutcomeSchema = budgetedSchema(
  z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('created'),
      relativePath: RelativeMarkdownPathSchema,
      bytes: z
        .number()
        .int()
        .min(0)
        .max(16 * 1_024 * 1_024),
    }),
    z.strictObject({
      status: z.literal('already_exists'),
      relativePath: RelativeMarkdownPathSchema,
    }),
    z.strictObject({
      status: z.literal('skipped'),
      relativePath: RelativeMarkdownPathSchema,
      reason: boundedString(SYNC_LIMITS.outcomeReasonBytes, 1),
    }),
    z.strictObject({
      status: z.literal('error'),
      relativePath: RelativeMarkdownPathSchema,
      code: boundedString(SYNC_LIMITS.errorCodeBytes, 1).regex(/^[a-z0-9_]+$/u),
    }),
  ]),
  persistedInputLimits,
);
export type WriteOutcome = z.infer<typeof WriteOutcomeSchema>;

export const SyncItemWriteStatusSchema = z.enum([
  'not_requested',
  'pending',
  'created',
  'already_exists',
  'skipped',
  'error',
]);
export type SyncItemWriteStatus = z.infer<typeof SyncItemWriteStatusSchema>;

const syncJobItemShape = {
  schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
  jobId: SyncJobIdSchema,
  sourceItemId: SourceItemIdSchema,
  item: SocialItemSchema,
  classification: SyncItemClassificationSchema,
  writeStatus: SyncItemWriteStatusSchema,
  outcome: WriteOutcomeSchema.optional(),
  discoveredAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
};

function validateSyncJobItem(
  row: z.infer<z.ZodObject<typeof syncJobItemShape>>,
  context: z.RefinementCtx,
): void {
  if (row.sourceItemId !== row.item.sourceItemId) {
    context.addIssue({
      code: 'custom',
      path: ['sourceItemId'],
      message: 'sourceItemId must match the nested SocialItem',
    });
  }
  if (timestampMillis(row.updatedAt) < timestampMillis(row.discoveredAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'updatedAt cannot precede discoveredAt',
    });
  }
  const terminalWriteStatuses = new Set<SyncItemWriteStatus>([
    'created',
    'already_exists',
    'skipped',
    'error',
  ]);
  if (terminalWriteStatuses.has(row.writeStatus) && row.outcome?.status !== row.writeStatus) {
    context.addIssue({
      code: 'custom',
      path: ['outcome'],
      message: 'Terminal writeStatus requires a matching outcome',
    });
  }
  if (!terminalWriteStatuses.has(row.writeStatus) && row.outcome !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['outcome'],
      message: 'Non-terminal writeStatus must not include an outcome',
    });
  }
  if (row.classification === 'pending' && row.writeStatus !== 'not_requested') {
    context.addIssue({
      code: 'custom',
      path: ['writeStatus'],
      message: 'Unclassified items cannot enter the write protocol',
    });
  }
  if (row.classification === 'error' && row.writeStatus !== 'not_requested') {
    context.addIssue({
      code: 'custom',
      path: ['writeStatus'],
      message: 'Classification errors cannot enter the write protocol',
    });
  }
}

const syncJobItemObjectSchema = z.strictObject(syncJobItemShape).superRefine(validateSyncJobItem);
export const SyncJobItemSchema = budgetedSchema(syncJobItemObjectSchema, persistedInputLimits);
export type SyncJobItem = z.infer<typeof SyncJobItemSchema>;

const syncJobItemRowObjectSchema = z
  .strictObject({
    key: boundedString(SYNC_LIMITS.jobIdBytes + SYNC_LIMITS.sourceItemIdBytes + 16, 3).refine(
      isSafeIdentifier,
    ),
    ...syncJobItemShape,
  })
  .superRefine((row, context) => {
    validateSyncJobItem(row, context);
    if (row.key !== expectedSyncJobItemKey(row.jobId, row.sourceItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'Item key must identify its job and source item',
      });
    }
  });
export const SyncJobItemRowSchema = budgetedSchema(
  syncJobItemRowObjectSchema,
  persistedInputLimits,
);
export type SyncJobItemRow = z.infer<typeof SyncJobItemRowSchema>;

const syncRecordObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    key: boundedString(SYNC_LIMITS.sourceItemIdBytes + 8, 3).refine(isSafeIdentifier),
    source: SocialSourceSchema,
    sourceItemId: SourceItemIdSchema,
    canonicalUrl: HttpsUrlSchema,
    contentHash: ContentHashSchema,
    relativePath: RelativeMarkdownPathSchema,
    completeness: CaptureCompletenessSchema,
    extractorVersion: positiveVersionSchema,
    importedAt: IsoTimestampSchema,
    lastSeenAt: IsoTimestampSchema,
  })
  .superRefine((record, context) => {
    validateSourceIdentity(record, context);
    if (record.key !== `${record.source}:${record.sourceItemId}`) {
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'Record key must be source:sourceItemId',
      });
    }
    if (timestampMillis(record.lastSeenAt) < timestampMillis(record.importedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['lastSeenAt'],
        message: 'lastSeenAt cannot precede importedAt',
      });
    }
  });
export const SyncRecordSchema = budgetedSchema(syncRecordObjectSchema, persistedInputLimits);
export type SyncRecord = z.infer<typeof SyncRecordSchema>;

const writeIntentObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    id: WriteIntentIdSchema,
    jobId: SyncJobIdSchema,
    itemKey: boundedString(SYNC_LIMITS.jobIdBytes + SYNC_LIMITS.sourceItemIdBytes + 16, 3).refine(
      isSafeIdentifier,
    ),
    recordKey: boundedString(SYNC_LIMITS.sourceItemIdBytes + 8, 3).refine(isSafeIdentifier),
    source: SocialSourceSchema,
    sourceItemId: SourceItemIdSchema,
    canonicalUrl: HttpsUrlSchema,
    contentHash: ContentHashSchema,
    relativePath: RelativeMarkdownPathSchema,
    completeness: CaptureCompletenessSchema,
    extractorVersion: positiveVersionSchema,
    createdAt: IsoTimestampSchema,
  })
  .superRefine((intent, context) => {
    validateSourceIdentity(intent, context);
    if (intent.itemKey !== expectedSyncJobItemKey(intent.jobId, intent.sourceItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['itemKey'],
        message: 'itemKey must identify the intent job and source item',
      });
    }
    if (intent.recordKey !== `${intent.source}:${intent.sourceItemId}`) {
      context.addIssue({
        code: 'custom',
        path: ['recordKey'],
        message: 'recordKey must be source:sourceItemId',
      });
    }
  });
export const WriteIntentSchema = budgetedSchema(writeIntentObjectSchema, persistedInputLimits);
export type WriteIntent = z.infer<typeof WriteIntentSchema>;

export const SyncMetaSchema = budgetedSchema(
  z.strictObject({
    key: z.literal('schema'),
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    databaseVersion: z.literal(1),
  }),
  persistedInputLimits,
);
export type SyncMeta = z.infer<typeof SyncMetaSchema>;

export function parseSocialItem(input: unknown): SocialItem {
  return SocialItemSchema.parse(input);
}

export function parseSyncJob(input: unknown): SyncJob {
  return SyncJobSchema.parse(input);
}

export function parseSyncRecord(input: unknown): SyncRecord {
  return SyncRecordSchema.parse(input);
}

export function makeSyncRecordKey(source: SocialSource, sourceItemId: string): string {
  return `${source}:${sourceItemId}`;
}

export function makeSyncJobItemKey(jobId: string, sourceItemId: string): string {
  return expectedSyncJobItemKey(jobId, sourceItemId);
}
