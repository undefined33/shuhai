import { z } from 'zod';

import type {
  AiProviderConfig,
  AiProviderErrorCode,
  AiProviderTestResult,
  AiProviderType,
  AppSettings,
  BackupRecord,
  BackupSummary,
  BookmarkItem,
  BookmarkNode,
  BookmarkOperation,
  BookmarkOperationCommandResponse,
  BookmarkTaskSettings,
  ClassificationPlan,
  ClassificationProgress,
  CustomRule,
  FolderItem,
  MarkdownTemplate,
  OnboardingProgressState,
  UrlHealthRecord,
} from './bookmark-types.js';
import {
  BookmarkOperationCommandResponseSchema,
  BookmarkOperationErrorCodeSchema,
  BookmarkOperationSchema,
} from './bookmark-types.js';
import {
  AI_PROVIDER_TYPES,
  DEFAULT_PROVIDER_IDS,
  isValidAiModel,
  providerTemplate,
} from './ai-providers.js';

export const EXTENSION_MESSAGE_LIMITS = Object.freeze({
  legacyRequest: {
    maxBytes: 512 * 1_024,
    maxDepth: 32,
    maxNodes: 20_000,
    maxStringBytes: 256 * 1_024,
  },
  legacyResponse: {
    maxBytes: 16 * 1_024 * 1_024,
    maxDepth: 64,
    maxNodes: 250_000,
    maxStringBytes: 2 * 1_024 * 1_024,
  },
  operationResponse: {
    maxBytes: 5 * 1_024 * 1_024,
    maxDepth: 64,
    maxNodes: 4_194_305,
    maxStringBytes: 64 * 1_024,
  },
  classificationRequest: {
    maxBytes: 8 * 1_024,
    maxDepth: 8,
    maxNodes: 64,
    maxStringBytes: 1 * 1_024,
  },
  classificationResponse: {
    maxBytes: 8 * 1_024 * 1_024,
    maxDepth: 32,
    maxNodes: 150_000,
    maxStringBytes: 256 * 1_024,
  },
} as const);

export interface StructuredInputLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
}

export type StructuredInputErrorCode =
  | 'invalid_message'
  | 'message_too_complex'
  | 'message_too_deep'
  | 'message_too_large'
  | 'string_too_large';

export class StructuredInputError extends Error {
  constructor(readonly code: StructuredInputErrorCode) {
    super('The extension message is invalid');
    this.name = 'StructuredInputError';
  }
}

interface CloneState {
  approximateBytes: number;
  nodes: number;
  readonly limits: StructuredInputLimits;
  readonly seen: WeakSet<object>;
}

const textEncoder = new TextEncoder();
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const arrayIndexPattern = /^(?:0|[1-9]\d*)$/u;
const requestIdPattern = /^[A-Za-z0-9:_-]{8,128}$/u;
const extensionIdPattern = /^[a-p]{32}$/u;

function addApproximateBytes(state: CloneState, bytes: number): void {
  state.approximateBytes += bytes;
  if (state.approximateBytes > state.limits.maxBytes) {
    throw new StructuredInputError('message_too_large');
  }
}

function boundedString(value: string, state: CloneState): string {
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes > state.limits.maxStringBytes) {
    throw new StructuredInputError('string_too_large');
  }
  addApproximateBytes(state, bytes);
  return value;
}

function ownDescriptors(value: object): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new StructuredInputError('invalid_message');
  }
}

function objectPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw new StructuredInputError('invalid_message');
  }
}

function cloneValue(value: unknown, depth: number, state: CloneState): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    throw new StructuredInputError('message_too_complex');
  }
  if (depth > state.limits.maxDepth) {
    throw new StructuredInputError('message_too_deep');
  }

  if (value === null) {
    addApproximateBytes(state, 4);
    return null;
  }
  if (typeof value === 'string') {
    return boundedString(value, state);
  }
  if (typeof value === 'boolean') {
    addApproximateBytes(state, value ? 4 : 5);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new StructuredInputError('invalid_message');
    }
    addApproximateBytes(state, String(value).length);
    return value;
  }
  if (typeof value !== 'object') {
    throw new StructuredInputError('invalid_message');
  }
  if (state.seen.has(value)) {
    throw new StructuredInputError('invalid_message');
  }
  state.seen.add(value);

  const prototype = objectPrototype(value);
  const descriptors = ownDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new StructuredInputError('invalid_message');
  }

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new StructuredInputError('invalid_message');
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) {
      throw new StructuredInputError('invalid_message');
    }
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new StructuredInputError('invalid_message');
    }
    const clone: unknown[] = new Array(length);
    addApproximateBytes(state, 2 + Math.max(0, length - 1));
    for (const key of keys) {
      if (key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || !arrayIndexPattern.test(key) || Number(key) >= length) {
        throw new StructuredInputError('invalid_message');
      }
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        !('value' in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw new StructuredInputError('invalid_message');
      }
      clone[index] = cloneValue(descriptor.value, depth + 1, state);
    }
    state.seen.delete(value);
    return clone;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new StructuredInputError('invalid_message');
  }
  const clone: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  addApproximateBytes(state, 2 + Math.max(0, keys.length - 1));
  for (const key of keys) {
    if (typeof key !== 'string' || forbiddenKeys.has(key)) {
      throw new StructuredInputError('invalid_message');
    }
    boundedString(key, state);
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      throw new StructuredInputError('invalid_message');
    }
    clone[key] = cloneValue(descriptor.value, depth + 1, state);
  }
  state.seen.delete(value);
  return clone;
}

export function cloneBoundedStructuredValue(
  value: unknown,
  limits: StructuredInputLimits,
): unknown {
  let clone: unknown;
  try {
    clone = cloneValue(value, 0, {
      approximateBytes: 0,
      limits,
      nodes: 0,
      seen: new WeakSet<object>(),
    });
  } catch (error) {
    if (error instanceof StructuredInputError) {
      throw error;
    }
    throw new StructuredInputError('invalid_message');
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(clone);
  } catch {
    throw new StructuredInputError('invalid_message');
  }
  if (textEncoder.encode(serialized).byteLength > limits.maxBytes) {
    throw new StructuredInputError('message_too_large');
  }
  return clone;
}

const requestIdSchema = z.string().regex(requestIdPattern);
const boundedText = (max: number, min = 0) => z.string().min(min).max(max);
const byteBoundedText = (maxBytes: number, min = 0) =>
  z
    .string()
    .min(min)
    .refine((value) => textEncoder.encode(value).byteLength <= maxBytes);
const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().min(0);
const optionalNonNegativeInteger = nonNegativeInteger.optional();
function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

const httpUrlSchema = boundedText(8_192, 1).refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !containsControlCharacter(value)
    );
  } catch {
    return false;
  }
});

const aiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES);
const aiConsentSchema: z.ZodType<{ provider: AiProviderType; confirmed: true }> = z.strictObject({
  provider: aiProviderTypeSchema,
  confirmed: z.literal(true),
});
const aiProviderSchema: z.ZodType<AiProviderConfig> = z
  .strictObject({
    id: boundedText(128, 1),
    name: boundedText(256, 1),
    provider: aiProviderTypeSchema,
    enabled: z.boolean(),
    model: boundedText(128, 1).refine(isValidAiModel),
    hasApiKey: z.boolean(),
  })
  .superRefine((value, context) => {
    const template = providerTemplate(value.provider);
    if (value.id !== DEFAULT_PROVIDER_IDS[value.provider] || value.name !== template.name) {
      context.addIssue({ code: 'custom', message: 'Provider identity mismatch' });
    }
  });

const aiLegacySummarySchema = z.strictObject({
  builtInConflicts: z.array(aiProviderTypeSchema).max(AI_PROVIDER_TYPES.length),
  customState: z.enum(['absent', 'disabled_no_key', 'conflict_has_key']),
});

const customRuleSchema: z.ZodType<CustomRule> = z.strictObject({
  id: boundedText(256).optional(),
  type: z.enum(['domain', 'title-keyword', 'url-pattern', 'combined']),
  pattern: boundedText(4_096),
  urlPattern: boundedText(4_096).optional(),
  titlePattern: boundedText(4_096).optional(),
  category: boundedText(1_024),
  tags: z.array(boundedText(512)).max(256),
  priority: finiteNumber.optional(),
  enabled: z.boolean().optional(),
});

const markdownTemplateSchema: z.ZodType<MarkdownTemplate> = z.strictObject({
  id: boundedText(256, 1),
  name: boundedText(512, 1),
  scope: z.enum(['bookmark', 'twitter', 'weibo', 'article']),
  frontmatter: boundedText(256 * 1_024),
  body: boundedText(2 * 1_024 * 1_024),
});

const aiProvidersSettingsSchema = z
  .array(aiProviderSchema)
  .length(AI_PROVIDER_TYPES.length)
  .superRefine((providers, context) => {
    const types = new Set(providers.map((provider) => provider.provider));
    if (
      types.size !== AI_PROVIDER_TYPES.length ||
      AI_PROVIDER_TYPES.some((provider) => !types.has(provider))
    ) {
      context.addIssue({ code: 'custom', message: 'Provider set mismatch' });
    }
  });

const appSettingsSchema: z.ZodType<AppSettings> = z.strictObject({
  useAi: z.boolean(),
  activeProviderId: boundedText(128, 1),
  aiProviders: aiProvidersSettingsSchema,
  aiLegacySummary: aiLegacySummarySchema,
  customRules: z.array(customRuleSchema).max(10_000),
  templates: z.array(markdownTemplateSchema).max(128),
  activeTemplateIds: z.strictObject({
    bookmark: boundedText(256).optional(),
    twitter: boundedText(256).optional(),
    weibo: boundedText(256).optional(),
    article: boundedText(256).optional(),
  }),
  defaultClassifyMode: z.enum(['safe', 'full']),
  exportDirectory: boundedText(4_096, 1),
});

const bookmarkTaskSettingsSchema: z.ZodType<BookmarkTaskSettings> = z.strictObject({
  useAi: z.boolean(),
  activeProviderId: boundedText(128, 1),
  aiProviders: aiProvidersSettingsSchema,
  aiLegacySummary: aiLegacySummarySchema,
  customRules: z.array(customRuleSchema).max(10_000),
  defaultClassifyMode: z.enum(['safe', 'full']),
});

const bookmarkItemSchema: z.ZodType<BookmarkItem> = z.strictObject({
  id: boundedText(512, 1),
  title: boundedText(8_192),
  url: boundedText(16_384, 1),
  parentId: boundedText(512, 1),
  parentTitle: boundedText(8_192),
  parentPath: boundedText(16_384),
  index: nonNegativeInteger,
  dateAdded: finiteNumber.optional(),
});

const folderItemSchema: z.ZodType<FolderItem> = z.strictObject({
  id: boundedText(512, 1),
  title: boundedText(8_192),
  path: boundedText(16_384),
  parentId: boundedText(512).optional(),
  bookmarkCount: nonNegativeInteger,
});

const bookmarkNodeSchema: z.ZodType<BookmarkNode> = z.lazy(() =>
  z.strictObject({
    id: boundedText(512, 1),
    title: boundedText(8_192),
    url: boundedText(16_384).optional(),
    parentId: boundedText(512).optional(),
    index: nonNegativeInteger.optional(),
    dateAdded: finiteNumber.optional(),
    children: z.array(bookmarkNodeSchema).max(100_000).optional(),
    folderPath: boundedText(16_384),
    bookmarkCount: nonNegativeInteger,
  }),
);

const movePlanSchema = z.strictObject({
  id: boundedText(512, 1),
  bookmarkId: boundedText(512, 1),
  bookmarkTitle: boundedText(8_192),
  bookmarkUrl: boundedText(16_384, 1),
  currentFolder: boundedText(16_384),
  targetFolder: boundedText(16_384),
  confidence: finiteNumber,
  reason: z.enum(['folder', 'rule', 'ai', 'manual']),
  ruleName: boundedText(1_024).optional(),
  tags: z.array(boundedText(512)).max(256),
  selected: z.boolean(),
});

const classificationPlanSchema: z.ZodType<ClassificationPlan> = z.strictObject({
  mode: z.enum(['safe', 'full']),
  moves: z.array(movePlanSchema).max(100_000),
  newFolders: z.array(boundedText(16_384)).max(100_000),
  unchanged: nonNegativeInteger,
  totalBookmarks: nonNegativeInteger,
  generatedAt: boundedText(64, 1),
});

const classificationProgressSchema: z.ZodType<ClassificationProgress> = z.strictObject({
  done: nonNegativeInteger,
  total: nonNegativeInteger,
  batch: nonNegativeInteger,
  totalBatches: nonNegativeInteger,
  elapsedMs: nonNegativeInteger,
  remainingMs: optionalNonNegativeInteger,
  cancelled: z.boolean().optional(),
});

export const UrlHealthRecordSchema: z.ZodType<UrlHealthRecord> = z.strictObject({
  bookmarkId: byteBoundedText(512, 1),
  bookmarkTitle: byteBoundedText(4 * 1_024),
  bookmarkUrl: byteBoundedText(8 * 1_024, 1),
  parentPath: byteBoundedText(8 * 1_024),
  status: z.enum(['alive', 'redirected', 'dead', 'error', 'skipped']),
  checkedAt: byteBoundedText(64, 1),
  durationMs: nonNegativeInteger,
  httpStatus: z.number().int().min(0).max(999).optional(),
  finalUrl: byteBoundedText(8 * 1_024).optional(),
  error: byteBoundedText(4 * 1_024).optional(),
});

export function isSafeHistoricalHealthUrl(value: string): boolean {
  return (
    httpUrlSchema.safeParse(value).success && textEncoder.encode(value).byteLength <= 8 * 1_024
  );
}

const backupKeySchema = z.string().regex(/^backup_[0-9]{1,16}$/u);
const backupTimestampSchema = boundedText(64, 1).refine((value) => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}, 'Invalid backup timestamp');

const backupRecordSchema: z.ZodType<BackupRecord> = z.strictObject({
  key: backupKeySchema,
  createdAt: backupTimestampSchema,
  bookmarkCount: nonNegativeInteger,
  tree: z.array(bookmarkNodeSchema).max(100_000),
});

const backupSummarySchema: z.ZodType<BackupSummary> = z.strictObject({
  key: backupKeySchema,
  createdAt: backupTimestampSchema,
  bookmarkCount: nonNegativeInteger,
});

const bookmarkTaskSnapshotSchema = z.strictObject({
  bookmarks: z.array(bookmarkItemSchema).max(100_000),
  folders: z.array(folderItemSchema).max(100_000),
  settings: bookmarkTaskSettingsSchema,
});

const onboardingProgressSchema: z.ZodType<OnboardingProgressState> = z.strictObject({
  vaultConfigured: z.boolean(),
  providerConfigured: z.boolean(),
  firstClassifyDone: z.boolean(),
  firstExportDone: z.boolean(),
});

export const AI_PROVIDER_CONNECTION_RESULTS = Object.freeze({
  connection_ok: Object.freeze({
    success: true,
    code: 'connection_ok',
    message: '连接成功，模型可用',
  }),
  permission_required: Object.freeze({
    success: false,
    code: 'permission_required',
    message: '需要先允许访问当前 AI 服务',
  }),
  permission_denied: Object.freeze({
    success: false,
    code: 'permission_denied',
    message: '未获得当前 AI 服务权限',
  }),
  secret_unavailable: Object.freeze({
    success: false,
    code: 'secret_unavailable',
    message: 'API Key 不可用，请重新配置',
  }),
  legacy_ai_config_conflict: Object.freeze({
    success: false,
    code: 'legacy_ai_config_conflict',
    message: '旧 AI 配置存在冲突，请先在设置中处理',
  }),
  request_invalid: Object.freeze({
    success: false,
    code: 'request_invalid',
    message: 'AI 请求配置无效',
  }),
  unauthorized: Object.freeze({
    success: false,
    code: 'unauthorized',
    message: 'API Key 无效',
  }),
  forbidden: Object.freeze({
    success: false,
    code: 'forbidden',
    message: 'AI 服务拒绝了请求',
  }),
  rate_limited: Object.freeze({
    success: false,
    code: 'rate_limited',
    message: 'AI 服务请求过于频繁，请稍后重试',
  }),
  provider_unavailable: Object.freeze({
    success: false,
    code: 'provider_unavailable',
    message: 'AI 服务暂时不可用',
  }),
  timeout: Object.freeze({
    success: false,
    code: 'timeout',
    message: 'AI 请求超时',
  }),
  aborted: Object.freeze({
    success: false,
    code: 'aborted',
    message: 'AI 请求已取消',
  }),
  response_too_large: Object.freeze({
    success: false,
    code: 'response_too_large',
    message: 'AI 响应超过安全上限',
  }),
  content_type_invalid: Object.freeze({
    success: false,
    code: 'content_type_invalid',
    message: 'AI 响应格式不受支持',
  }),
  response_encoding_invalid: Object.freeze({
    success: false,
    code: 'response_encoding_invalid',
    message: 'AI 响应编码无效',
  }),
  response_invalid: Object.freeze({
    success: false,
    code: 'response_invalid',
    message: 'AI 响应未通过安全校验',
  }),
  network_failed: Object.freeze({
    success: false,
    code: 'network_failed',
    message: 'AI 网络连接失败',
  }),
} as const);

export type SafeAiProviderTestResult = AiProviderTestResult;

const aiProviderErrorCodeSchema: z.ZodType<AiProviderErrorCode> = z.enum([
  'permission_required',
  'permission_denied',
  'secret_unavailable',
  'legacy_ai_config_conflict',
  'request_invalid',
  'unauthorized',
  'forbidden',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'aborted',
  'response_too_large',
  'content_type_invalid',
  'response_encoding_invalid',
  'response_invalid',
  'network_failed',
]);

const aiProviderTestResultSchema: z.ZodType<SafeAiProviderTestResult> = z
  .union([
    z.strictObject({
      success: z.literal(true),
      code: z.literal('connection_ok'),
      message: z.literal(AI_PROVIDER_CONNECTION_RESULTS.connection_ok.message),
    }),
    z.strictObject({
      success: z.literal(false),
      code: aiProviderErrorCodeSchema,
      message: boundedText(128, 1),
    }),
  ])
  .superRefine((value, context) => {
    const expected =
      AI_PROVIDER_CONNECTION_RESULTS[value.code as keyof typeof AI_PROVIDER_CONNECTION_RESULTS];
    if (!expected || value.message !== expected.message || value.success !== expected.success) {
      context.addIssue({ code: 'custom', message: 'AI result code/message mismatch' });
    }
  });

export interface LegacyPendingSummary {
  present: boolean;
  count: number | null;
  approximateBytes: number;
  state: 'absent' | 'valid' | 'invalid' | 'oversize' | 'unavailable';
}

const legacyPendingSummarySchema: z.ZodType<LegacyPendingSummary> = z.strictObject({
  present: z.boolean(),
  count: z.number().int().min(0).max(20).nullable(),
  approximateBytes: nonNegativeInteger,
  state: z.enum(['absent', 'valid', 'invalid', 'oversize', 'unavailable']),
});

export const LegacyRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('security:getBootstrapStatus') }),
  z.strictObject({ type: z.literal('bookmarkTask:getSnapshot') }),
  z.strictObject({ type: z.literal('operations:getRecent') }),
  z.strictObject({
    type: z.literal('plan:create'),
    mode: z.enum(['safe', 'full']),
    ai: aiConsentSchema.optional(),
  }),
  z.strictObject({ type: z.literal('settings:get') }),
  z.strictObject({ type: z.literal('settings:set'), settings: appSettingsSchema }),
  z.strictObject({
    type: z.literal('ai:secret:set'),
    provider: aiProviderTypeSchema,
    apiKey: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
  }),
  z.strictObject({
    type: z.literal('ai:secret:clear'),
    provider: aiProviderTypeSchema,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    type: z.literal('ai:legacy:discard'),
    confirmed: z.literal(true),
  }),
  z.strictObject({ type: z.literal('ai:testConnection'), provider: aiProviderTypeSchema }),
  z.strictObject({ type: z.literal('onboarding:getProgress') }),
  z.strictObject({ type: z.literal('onboarding:set'), onboarded: z.boolean() }),
  z.strictObject({
    type: z.literal('legacyPending:inspect'),
    requestId: requestIdSchema,
  }),
  z.strictObject({
    type: z.literal('legacyPending:clear'),
    requestId: requestIdSchema,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    type: z.literal('xSingle:start'),
    requestId: requestIdSchema,
  }),
  z.strictObject({ type: z.literal('health:listRecords') }),
  z.strictObject({
    type: z.literal('health:clearRecords'),
    confirmed: z.literal(true),
  }),
  z.strictObject({ type: z.literal('backups:listSummaries') }),
  z.strictObject({
    type: z.literal('backups:get'),
    key: backupKeySchema,
  }),
]);

export type ExtensionRequest = z.infer<typeof LegacyRequestSchema>;

export interface LegacySuccessDataByType {
  'security:getBootstrapStatus': { ready: true };
  'bookmarkTask:getSnapshot': {
    bookmarks: BookmarkItem[];
    folders: FolderItem[];
    settings: BookmarkTaskSettings;
  };
  'operations:getRecent': { operations: BookmarkOperation[] };
  'plan:create': ClassificationPlan;
  'settings:get': AppSettings;
  'settings:set': AppSettings;
  'ai:secret:set': AppSettings;
  'ai:secret:clear': AppSettings;
  'ai:legacy:discard': AppSettings;
  'ai:testConnection': SafeAiProviderTestResult;
  'onboarding:getProgress': OnboardingProgressState;
  'onboarding:set': { onboarded: boolean };
  'legacyPending:inspect': LegacyPendingSummary;
  'legacyPending:clear': { cleared: true };
  'xSingle:start': {
    jobId: string;
    status: 'ready_for_review';
    classification: 'new' | 'existing' | 'changed' | 'incomplete' | 'error';
    noWriteCandidate: boolean;
  };
  'health:listRecords': { records: UrlHealthRecord[] };
  'health:clearRecords': { cleared: true };
  'backups:listSummaries': { backups: BackupSummary[] };
  'backups:get': { backup: BackupRecord | null };
}

export type LegacySuccessData<R extends ExtensionRequest> = LegacySuccessDataByType[R['type']];

export const LEGACY_ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Extension request rejected',
  forbidden_sender: 'Extension request rejected',
  response_invalid: 'Extension response rejected',
  storage_unavailable: 'ShuHai secure storage is unavailable',
  security_bootstrap_failed: 'ShuHai security initialization failed',
  operation_failed: 'ShuHai request failed',
  x_route_invalid: 'Open an exact X status page and try again',
  x_tab_changed: 'The X tab changed before capture completed',
  x_extract_failed: 'The X item could not be extracted safely',
  x_payload_invalid: 'The extracted X item failed validation',
  active_x_job_exists: 'Finish or cancel the current X review first',
} as const);

export type LegacyErrorCode = keyof typeof LEGACY_ERROR_MESSAGES;

export interface LegacyErrorResponse {
  readonly ok: false;
  readonly error: (typeof LEGACY_ERROR_MESSAGES)[LegacyErrorCode];
  readonly errorCode: LegacyErrorCode;
}

export type LegacyResponse<R extends ExtensionRequest> =
  | { readonly ok: true; readonly data: LegacySuccessData<R> }
  | LegacyErrorResponse;

const legacyErrorSchema = z
  .strictObject({
    ok: z.literal(false),
    error: z.enum([
      LEGACY_ERROR_MESSAGES.invalid_request,
      LEGACY_ERROR_MESSAGES.forbidden_sender,
      LEGACY_ERROR_MESSAGES.response_invalid,
      LEGACY_ERROR_MESSAGES.storage_unavailable,
      LEGACY_ERROR_MESSAGES.security_bootstrap_failed,
      LEGACY_ERROR_MESSAGES.operation_failed,
      LEGACY_ERROR_MESSAGES.x_route_invalid,
      LEGACY_ERROR_MESSAGES.x_tab_changed,
      LEGACY_ERROR_MESSAGES.x_extract_failed,
      LEGACY_ERROR_MESSAGES.x_payload_invalid,
      LEGACY_ERROR_MESSAGES.active_x_job_exists,
    ]),
    errorCode: z.enum([
      'invalid_request',
      'forbidden_sender',
      'response_invalid',
      'storage_unavailable',
      'security_bootstrap_failed',
      'operation_failed',
      'x_route_invalid',
      'x_tab_changed',
      'x_extract_failed',
      'x_payload_invalid',
      'active_x_job_exists',
    ]),
  })
  .superRefine((value, context) => {
    if (value.error !== LEGACY_ERROR_MESSAGES[value.errorCode]) {
      context.addIssue({ code: 'custom', message: 'Legacy error code/message mismatch' });
    }
  });

const successDataSchemas: Record<ExtensionRequest['type'], z.ZodType> = {
  'security:getBootstrapStatus': z.strictObject({ ready: z.literal(true) }),
  'bookmarkTask:getSnapshot': bookmarkTaskSnapshotSchema,
  'operations:getRecent': z.strictObject({
    operations: z.array(BookmarkOperationSchema).max(100),
  }),
  'plan:create': classificationPlanSchema,
  'settings:get': appSettingsSchema,
  'settings:set': appSettingsSchema,
  'ai:secret:set': appSettingsSchema,
  'ai:secret:clear': appSettingsSchema,
  'ai:legacy:discard': appSettingsSchema,
  'ai:testConnection': aiProviderTestResultSchema,
  'onboarding:getProgress': onboardingProgressSchema,
  'onboarding:set': z.strictObject({ onboarded: z.boolean() }),
  'legacyPending:inspect': legacyPendingSummarySchema,
  'legacyPending:clear': z.strictObject({ cleared: z.literal(true) }),
  'xSingle:start': z.strictObject({
    jobId: boundedText(128, 1),
    status: z.literal('ready_for_review'),
    classification: z.enum(['new', 'existing', 'changed', 'incomplete', 'error']),
    noWriteCandidate: z.boolean(),
  }),
  'health:listRecords': z.strictObject({
    records: z.array(UrlHealthRecordSchema).max(10_000),
  }),
  'health:clearRecords': z.strictObject({ cleared: z.literal(true) }),
  'backups:listSummaries': z.strictObject({
    backups: z.array(backupSummarySchema).max(5),
  }),
  'backups:get': z.strictObject({ backup: backupRecordSchema.nullable() }),
};

function responseLimits(request: ExtensionRequest): StructuredInputLimits {
  return request.type === 'operations:getRecent'
    ? EXTENSION_MESSAGE_LIMITS.operationResponse
    : EXTENSION_MESSAGE_LIMITS.legacyResponse;
}

export function parseExtensionRequest(value: unknown): ExtensionRequest {
  const clone = cloneBoundedStructuredValue(value, EXTENSION_MESSAGE_LIMITS.legacyRequest);
  const parsed = LegacyRequestSchema.safeParse(clone);
  if (!parsed.success) {
    throw new StructuredInputError('invalid_message');
  }
  return parsed.data;
}

const OPTIONS_REQUEST_TYPES: ReadonlySet<ExtensionRequest['type']> = new Set([
  'security:getBootstrapStatus',
  'settings:get',
  'settings:set',
  'ai:secret:set',
  'ai:secret:clear',
  'ai:legacy:discard',
  'ai:testConnection',
  'legacyPending:inspect',
  'legacyPending:clear',
  'backups:listSummaries',
  'backups:get',
  'health:listRecords',
  'health:clearRecords',
]);

export function isOptionsPageRequest(request: ExtensionRequest): boolean {
  return OPTIONS_REQUEST_TYPES.has(request.type);
}

export function makeLegacyError(errorCode: LegacyErrorCode): LegacyErrorResponse {
  return {
    ok: false,
    error: LEGACY_ERROR_MESSAGES[errorCode],
    errorCode,
  };
}

export function parseLegacyResponse<R extends ExtensionRequest>(
  request: R,
  value: unknown,
): LegacyResponse<R> {
  const clone = cloneBoundedStructuredValue(value, responseLimits(request));
  const error = legacyErrorSchema.safeParse(clone);
  if (error.success) {
    if (request.type === 'security:getBootstrapStatus') {
      if (error.data.errorCode !== 'security_bootstrap_failed') {
        throw new StructuredInputError('invalid_message');
      }
    } else if (error.data.errorCode === 'security_bootstrap_failed') {
      throw new StructuredInputError('invalid_message');
    }
    return error.data as LegacyResponse<R>;
  }
  const success = z
    .strictObject({
      ok: z.literal(true),
      data: successDataSchemas[request.type],
    })
    .safeParse(clone);
  if (!success.success) {
    throw new StructuredInputError('invalid_message');
  }
  return success.data as LegacyResponse<R>;
}

const bookmarkOperationMessageResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: BookmarkOperationCommandResponseSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.literal('Bookmark operation command rejected'),
    errorCode: z.union([
      BookmarkOperationErrorCodeSchema,
      z.enum(['forbidden_sender', 'internal_error']),
    ]),
  }),
]);

export type BookmarkOperationMessageResponse =
  | { readonly ok: true; readonly data: BookmarkOperationCommandResponse }
  | {
      readonly ok: false;
      readonly error: 'Bookmark operation command rejected';
      readonly errorCode:
        | z.infer<typeof BookmarkOperationErrorCodeSchema>
        | 'forbidden_sender'
        | 'internal_error';
    };

export function parseBookmarkOperationMessageResponse(
  value: unknown,
  expectedRequestId: string,
): BookmarkOperationMessageResponse {
  const clone = cloneBoundedStructuredValue(value, EXTENSION_MESSAGE_LIMITS.operationResponse);
  const parsed = bookmarkOperationMessageResponseSchema.safeParse(clone);
  if (!parsed.success) {
    throw new StructuredInputError('invalid_message');
  }
  if (parsed.data.ok && parsed.data.data.receipt.requestId !== expectedRequestId) {
    throw new StructuredInputError('invalid_message');
  }
  return parsed.data as BookmarkOperationMessageResponse;
}

export const ClassificationPortRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plan:create'),
    requestId: requestIdSchema,
    mode: z.enum(['safe', 'full']),
    ai: aiConsentSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('cancel'),
    requestId: requestIdSchema,
    targetRequestId: requestIdSchema,
  }),
]);

export type ClassificationPortRequest = z.infer<typeof ClassificationPortRequestSchema>;

export const ClassificationPortMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('progress'),
    requestId: requestIdSchema,
    progress: classificationProgressSchema,
  }),
  z.strictObject({
    type: z.literal('complete'),
    requestId: requestIdSchema,
    plan: classificationPlanSchema,
    progress: classificationProgressSchema,
    cancelled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('error'),
    requestId: requestIdSchema,
    error: z.literal('Classification request failed'),
    errorCode: z.enum([
      'classification_in_progress',
      'invalid_request',
      'operation_failed',
      'storage_unavailable',
    ]),
  }),
  z.strictObject({
    type: z.literal('cancelled'),
    requestId: requestIdSchema,
    targetRequestId: requestIdSchema,
  }),
]);

export type ClassificationPortMessage = z.infer<typeof ClassificationPortMessageSchema>;

export function parseClassificationPortRequest(value: unknown): ClassificationPortRequest {
  const clone = cloneBoundedStructuredValue(value, EXTENSION_MESSAGE_LIMITS.classificationRequest);
  const parsed = ClassificationPortRequestSchema.safeParse(clone);
  if (!parsed.success) {
    throw new StructuredInputError('invalid_message');
  }
  return parsed.data;
}

export function parseClassificationPortMessage(value: unknown): ClassificationPortMessage {
  const clone = cloneBoundedStructuredValue(value, EXTENSION_MESSAGE_LIMITS.classificationResponse);
  const parsed = ClassificationPortMessageSchema.safeParse(clone);
  if (!parsed.success) {
    throw new StructuredInputError('invalid_message');
  }
  return parsed.data;
}

export type ExtensionUiSurface = 'popup' | 'sidepanel';

export interface ValidatedExtensionUiSender {
  readonly surface: ExtensionUiSurface;
}

function validateExactExtensionPageSender(
  sender: chrome.runtime.MessageSender | undefined,
): string | undefined {
  if (!sender || !extensionIdPattern.test(chrome.runtime.id)) {
    return undefined;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(sender);
    const idDescriptor = descriptors.id;
    const urlDescriptor = descriptors.url;
    const tabDescriptor = descriptors.tab;
    const originDescriptor = descriptors.origin;
    if (
      !idDescriptor ||
      !('value' in idDescriptor) ||
      idDescriptor.value !== chrome.runtime.id ||
      !urlDescriptor ||
      !('value' in urlDescriptor) ||
      typeof urlDescriptor.value !== 'string' ||
      (tabDescriptor !== undefined &&
        (!('value' in tabDescriptor) || tabDescriptor.value !== undefined)) ||
      (originDescriptor !== undefined &&
        (!('value' in originDescriptor) || typeof originDescriptor.value !== 'string'))
    ) {
      return undefined;
    }
    const senderUrlValue = urlDescriptor.value;
    const senderOrigin =
      originDescriptor && 'value' in originDescriptor
        ? (originDescriptor.value as string)
        : undefined;
    const extensionRoot = new URL(chrome.runtime.getURL('/'));
    const senderUrl = new URL(senderUrlValue);
    const extensionOrigin = `${extensionRoot.protocol}//${extensionRoot.host}`;
    if (
      extensionRoot.protocol !== 'chrome-extension:' ||
      extensionRoot.hostname !== chrome.runtime.id ||
      senderUrl.protocol !== extensionRoot.protocol ||
      senderUrl.host !== extensionRoot.host ||
      senderUrl.username !== '' ||
      senderUrl.password !== '' ||
      senderUrl.search !== '' ||
      senderUrl.hash !== ''
    ) {
      return undefined;
    }
    if (senderOrigin !== undefined && senderOrigin !== extensionOrigin) {
      return undefined;
    }
    return senderUrl.pathname;
  } catch {
    return undefined;
  }
}

export function validateExtensionUiSender(
  sender: chrome.runtime.MessageSender | undefined,
  expectedSurface?: ExtensionUiSurface,
): ValidatedExtensionUiSender | undefined {
  const pathname = validateExactExtensionPageSender(sender);
  const surface =
    pathname === '/popup/index.html'
      ? 'popup'
      : pathname === '/sidepanel/index.html'
        ? 'sidepanel'
        : undefined;
  if (!surface || (expectedSurface !== undefined && surface !== expectedSurface)) {
    return undefined;
  }
  return { surface };
}

export function validateOptionsPageSender(
  sender: chrome.runtime.MessageSender | undefined,
): { readonly surface: 'options' } | undefined {
  return validateExactExtensionPageSender(sender) === '/options/index.html'
    ? { surface: 'options' }
    : undefined;
}
