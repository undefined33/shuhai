import { z } from 'zod';

export const SURFACE_PROTOCOL = 'shuhai-surface' as const;
export const SURFACE_VERSION = 1 as const;
export const SURFACE_REGISTRY_KEY = 'shuhai:surface:v1:registry' as const;
export const SURFACE_INTENT_TTL_MS = 10_000;
export const SURFACE_TOMBSTONE_TTL_MS = 30_000;
export const SURFACE_MAX_PENDING_INTENTS = 8;
export const SURFACE_MAX_TOMBSTONES = 16;

interface SurfaceInputLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
}

interface SurfaceCloneState {
  approximateBytes: number;
  nodes: number;
  readonly limits: SurfaceInputLimits;
  readonly seen: WeakSet<object>;
}

class SurfaceInputError extends Error {
  constructor() {
    super('Invalid surface input');
    this.name = 'SurfaceInputError';
  }
}

const surfaceTextEncoder = new TextEncoder();
const forbiddenSurfaceKeys = new Set(['__proto__', 'constructor', 'prototype']);
const surfaceArrayIndexPattern = /^(?:0|[1-9]\d*)$/u;

function addSurfaceBytes(state: SurfaceCloneState, bytes: number): void {
  state.approximateBytes += bytes;
  if (state.approximateBytes > state.limits.maxBytes) {
    throw new SurfaceInputError();
  }
}

function cloneSurfaceString(value: string, state: SurfaceCloneState): string {
  const bytes = surfaceTextEncoder.encode(value).byteLength;
  if (bytes > state.limits.maxStringBytes) {
    throw new SurfaceInputError();
  }
  addSurfaceBytes(state, bytes);
  return value;
}

function surfaceDescriptors(value: object): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new SurfaceInputError();
  }
}

function surfacePrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw new SurfaceInputError();
  }
}

function cloneSurfaceValue(value: unknown, depth: number, state: SurfaceCloneState): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes || depth > state.limits.maxDepth) {
    throw new SurfaceInputError();
  }

  if (value === null) {
    addSurfaceBytes(state, 4);
    return null;
  }
  if (typeof value === 'string') {
    return cloneSurfaceString(value, state);
  }
  if (typeof value === 'boolean') {
    addSurfaceBytes(state, value ? 4 : 5);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SurfaceInputError();
    }
    addSurfaceBytes(state, String(value).length);
    return value;
  }
  if (typeof value !== 'object' || state.seen.has(value)) {
    throw new SurfaceInputError();
  }
  state.seen.add(value);

  const prototype = surfacePrototype(value);
  const descriptors = surfaceDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new SurfaceInputError();
  }

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new SurfaceInputError();
    }
    const lengthDescriptor = descriptors.length;
    const length =
      lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || (length as number) < 0) {
      throw new SurfaceInputError();
    }
    const safeLength = length as number;
    const clone: unknown[] = new Array(safeLength);
    addSurfaceBytes(state, 2 + Math.max(0, safeLength - 1));
    for (const key of keys) {
      if (key === 'length') continue;
      if (
        typeof key !== 'string' ||
        !surfaceArrayIndexPattern.test(key) ||
        Number(key) >= safeLength
      ) {
        throw new SurfaceInputError();
      }
    }
    for (let index = 0; index < safeLength; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) {
        throw new SurfaceInputError();
      }
      clone[index] = cloneSurfaceValue(descriptor.value, depth + 1, state);
    }
    state.seen.delete(value);
    return clone;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new SurfaceInputError();
  }
  const clone: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  addSurfaceBytes(state, 2 + Math.max(0, keys.length - 1));
  for (const key of keys) {
    if (typeof key !== 'string' || forbiddenSurfaceKeys.has(key)) {
      throw new SurfaceInputError();
    }
    cloneSurfaceString(key, state);
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.get ||
      descriptor.set
    ) {
      throw new SurfaceInputError();
    }
    clone[key] = cloneSurfaceValue(descriptor.value, depth + 1, state);
  }
  state.seen.delete(value);
  return clone;
}

function cloneBoundedSurfaceValue(value: unknown, limits: SurfaceInputLimits): unknown {
  let clone: unknown;
  try {
    clone = cloneSurfaceValue(value, 0, {
      approximateBytes: 0,
      limits,
      nodes: 0,
      seen: new WeakSet<object>(),
    });
  } catch (error) {
    if (error instanceof SurfaceInputError) {
      throw error;
    }
    throw new SurfaceInputError();
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(clone);
  } catch {
    throw new SurfaceInputError();
  }
  if (surfaceTextEncoder.encode(serialized).byteLength > limits.maxBytes) {
    throw new SurfaceInputError();
  }
  return clone;
}

const REQUEST_LIMITS: SurfaceInputLimits = Object.freeze({
  maxBytes: 512,
  maxDepth: 3,
  maxNodes: 24,
  maxStringBytes: 128,
});

const RESPONSE_LIMITS: SurfaceInputLimits = Object.freeze({
  maxBytes: 2_048,
  maxDepth: 5,
  maxNodes: 64,
  maxStringBytes: 128,
});

const REGISTRY_LIMITS: SurfaceInputLimits = Object.freeze({
  maxBytes: 4_096,
  maxDepth: 5,
  maxNodes: 128,
  maxStringBytes: 128,
});

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const safeIdSchema = z.string().regex(SAFE_ID_PATTERN);
const safeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const countSchema = z.number().int().min(0).max(1_000_000);
const isoTimestampSchema = z.string().max(64).datetime({ offset: true });

export const SurfaceTargetSchema = z.enum(['x-sync', 'x-single', 'bookmarks-transition']);
export type SurfaceTarget = z.infer<typeof SurfaceTargetSchema>;

export const SurfaceActiveTaskSchema = z.strictObject({
  kind: z.enum(['x-sync', 'x-single']),
  status: z.enum(['prepared', 'scanning', 'paused', 'ready_for_review', 'writing', 'partial']),
  updatedAt: isoTimestampSchema,
});
export type SurfaceActiveTask = z.infer<typeof SurfaceActiveTaskSchema>;

export const SurfaceLaunchIntentSchema = z.strictObject({
  intentId: safeIdSchema,
  target: SurfaceTargetSchema,
  windowId: safeIntegerSchema,
  expiresAtMs: safeIntegerSchema,
});
export type SurfaceLaunchIntent = z.infer<typeof SurfaceLaunchIntentSchema>;

export const SurfaceSummarySchema = z.strictObject({
  bookmarkCount: countSchema.nullable(),
  folderCount: countSchema.nullable(),
  vaultConfigured: z.boolean().nullable(),
  aiConfigured: z.boolean().nullable(),
  lastSavedAt: isoTimestampSchema.nullable(),
  activeTask: SurfaceActiveTaskSchema.nullable(),
  pendingLaunch: SurfaceLaunchIntentSchema.nullable(),
});
export type SurfaceSummary = z.infer<typeof SurfaceSummarySchema>;

const commonRequestShape = {
  protocol: z.literal(SURFACE_PROTOCOL),
  version: z.literal(SURFACE_VERSION),
  requestId: safeIdSchema,
  windowId: safeIntegerSchema,
} as const;

export const SurfaceRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commonRequestShape,
    type: z.literal('summary'),
  }),
  z.strictObject({
    ...commonRequestShape,
    type: z.literal('launch'),
    target: SurfaceTargetSchema,
  }),
  z.strictObject({
    ...commonRequestShape,
    type: z.literal('ackLaunch'),
    intentId: safeIdSchema,
  }),
]);
export type SurfaceRequest = z.infer<typeof SurfaceRequestSchema>;

export interface SurfaceSuccessDataByType {
  summary: SurfaceSummary;
  launch: SurfaceLaunchIntent;
  ackLaunch: {
    acknowledged: true;
    alreadyAcknowledged: boolean;
  };
}

export const SURFACE_ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Surface request rejected',
  forbidden_sender: 'Surface request rejected',
  window_unavailable: 'Chrome window is unavailable',
  summary_unavailable: 'Surface summary is unavailable',
  storage_unavailable: 'Surface session storage is unavailable',
  intent_expired: 'Surface launch expired',
  intent_mismatch: 'Surface launch does not match',
  operation_failed: 'Surface request failed',
} as const);

export type SurfaceErrorCode = keyof typeof SURFACE_ERROR_MESSAGES;

export interface SurfaceErrorResponse {
  readonly protocol: typeof SURFACE_PROTOCOL;
  readonly version: typeof SURFACE_VERSION;
  readonly requestId: string;
  readonly ok: false;
  readonly errorCode: SurfaceErrorCode;
  readonly message: (typeof SURFACE_ERROR_MESSAGES)[SurfaceErrorCode];
}

export type SurfaceSuccessResponse<R extends SurfaceRequest = SurfaceRequest> = {
  readonly protocol: typeof SURFACE_PROTOCOL;
  readonly version: typeof SURFACE_VERSION;
  readonly requestId: string;
  readonly ok: true;
  readonly data: SurfaceSuccessDataByType[R['type']];
};

export type SurfaceResponse<R extends SurfaceRequest = SurfaceRequest> =
  | SurfaceSuccessResponse<R>
  | SurfaceErrorResponse;

const errorCodeSchema = z.enum([
  'invalid_request',
  'forbidden_sender',
  'window_unavailable',
  'summary_unavailable',
  'storage_unavailable',
  'intent_expired',
  'intent_mismatch',
  'operation_failed',
]);

const errorResponseSchema = z
  .strictObject({
    protocol: z.literal(SURFACE_PROTOCOL),
    version: z.literal(SURFACE_VERSION),
    requestId: safeIdSchema,
    ok: z.literal(false),
    errorCode: errorCodeSchema,
    message: z.string().max(128),
  })
  .superRefine((value, context) => {
    if (value.message !== SURFACE_ERROR_MESSAGES[value.errorCode]) {
      context.addIssue({ code: 'custom', path: ['message'], message: 'Surface error mismatch' });
    }
  });

const successResponseSchemas = {
  summary: z.strictObject({
    protocol: z.literal(SURFACE_PROTOCOL),
    version: z.literal(SURFACE_VERSION),
    requestId: safeIdSchema,
    ok: z.literal(true),
    data: SurfaceSummarySchema,
  }),
  launch: z.strictObject({
    protocol: z.literal(SURFACE_PROTOCOL),
    version: z.literal(SURFACE_VERSION),
    requestId: safeIdSchema,
    ok: z.literal(true),
    data: SurfaceLaunchIntentSchema,
  }),
  ackLaunch: z.strictObject({
    protocol: z.literal(SURFACE_PROTOCOL),
    version: z.literal(SURFACE_VERSION),
    requestId: safeIdSchema,
    ok: z.literal(true),
    data: z.strictObject({
      acknowledged: z.literal(true),
      alreadyAcknowledged: z.boolean(),
    }),
  }),
} as const;

export const SurfaceIntentTombstoneSchema = z.strictObject({
  intentId: safeIdSchema,
  windowId: safeIntegerSchema,
  acknowledgedAtMs: safeIntegerSchema,
  expiresAtMs: safeIntegerSchema,
});
export type SurfaceIntentTombstone = z.infer<typeof SurfaceIntentTombstoneSchema>;

export const SurfaceSessionRegistrySchema = z.strictObject({
  version: z.literal(SURFACE_VERSION),
  pending: z.array(SurfaceLaunchIntentSchema).max(SURFACE_MAX_PENDING_INTENTS),
  tombstones: z.array(SurfaceIntentTombstoneSchema).max(SURFACE_MAX_TOMBSTONES),
});
export type SurfaceSessionRegistry = z.infer<typeof SurfaceSessionRegistrySchema>;

export function emptySurfaceSessionRegistry(): SurfaceSessionRegistry {
  return { version: SURFACE_VERSION, pending: [], tombstones: [] };
}

export function parseSurfaceRequest(value: unknown): SurfaceRequest {
  const clone = cloneBoundedSurfaceValue(value, REQUEST_LIMITS);
  return SurfaceRequestSchema.parse(clone);
}

export function parseSurfaceResponse<R extends SurfaceRequest>(
  request: R,
  value: unknown,
): SurfaceResponse<R> {
  const clone = cloneBoundedSurfaceValue(value, RESPONSE_LIMITS);
  const success = successResponseSchemas[request.type].safeParse(clone);
  if (success.success) {
    if (success.data.requestId !== request.requestId) {
      throw new Error('surface_response_mismatch');
    }
    return success.data as SurfaceSuccessResponse<R>;
  }

  const failure = errorResponseSchema.parse(clone);
  if (failure.requestId !== request.requestId) {
    throw new Error('surface_response_mismatch');
  }
  return failure as SurfaceErrorResponse;
}

export function parseSurfaceSessionRegistry(value: unknown): SurfaceSessionRegistry {
  const clone = cloneBoundedSurfaceValue(value, REGISTRY_LIMITS);
  return SurfaceSessionRegistrySchema.parse(clone);
}

export function makeSurfaceSuccess<R extends SurfaceRequest>(
  request: R,
  data: SurfaceSuccessDataByType[R['type']],
): SurfaceSuccessResponse<R> {
  const response = {
    protocol: SURFACE_PROTOCOL,
    version: SURFACE_VERSION,
    requestId: request.requestId,
    ok: true as const,
    data,
  };
  return parseSurfaceResponse(request, response) as SurfaceSuccessResponse<R>;
}

export function makeSurfaceError(
  requestId: string,
  errorCode: SurfaceErrorCode,
): SurfaceErrorResponse {
  const safeRequestId = SAFE_ID_PATTERN.test(requestId) ? requestId : 'invalid-request';
  return errorResponseSchema.parse({
    protocol: SURFACE_PROTOCOL,
    version: SURFACE_VERSION,
    requestId: safeRequestId,
    ok: false,
    errorCode,
    message: SURFACE_ERROR_MESSAGES[errorCode],
  }) as SurfaceErrorResponse;
}

export function hasSurfaceProtocol(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'protocol');
    if (!descriptor) {
      return false;
    }
    return !('value' in descriptor) || descriptor.value === SURFACE_PROTOCOL;
  } catch {
    return true;
  }
}
