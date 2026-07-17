import { z } from 'zod';

export type ClassificationReason = 'folder' | 'rule' | 'ai' | 'manual';
export type ClassificationMode = 'safe' | 'full';
export type ExportScope = 'all' | 'plan' | 'selected';
export type CaptureSource = 'page' | 'twitter' | 'weibo' | 'article';
export type UrlHealthStatus = 'alive' | 'redirected' | 'dead' | 'error' | 'skipped';
export type AiProviderType = 'deepseek' | 'kimi' | 'glm' | 'openai-compatible';
export type ExtractorPlatform = 'twitter' | 'weibo';

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderType;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiProviderTemplate {
  provider: AiProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  description: string;
}

export interface AiProviderTestResult {
  success: boolean;
  message: string;
  status?: number;
}

export const PROVIDER_TEMPLATES: AiProviderTemplate[] = [
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '高性价比，适合书签分类',
  },
  {
    provider: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: '月之暗面，支持长上下文',
  },
  {
    provider: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4'],
    description: '智谱 AI，国产大模型',
  },
  {
    provider: 'openai-compatible',
    name: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    description: '任何兼容 OpenAI /chat/completions 接口的服务',
  },
];

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  index?: number;
  dateAdded?: number;
  children?: BookmarkNode[];
  folderPath: string;
  bookmarkCount: number;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  parentId: string;
  parentTitle: string;
  parentPath: string;
  index: number;
  dateAdded?: number;
}

export interface FolderItem {
  id: string;
  title: string;
  path: string;
  parentId?: string;
  bookmarkCount: number;
}

export type RuleType = 'domain' | 'title-keyword' | 'url-pattern' | 'combined';

export interface CustomRule {
  id?: string;
  type: RuleType;
  pattern: string;
  urlPattern?: string;
  titlePattern?: string;
  category: string;
  tags: string[];
  priority?: number;
  enabled?: boolean;
}

export type MarkdownTemplateScope = 'bookmark' | 'twitter' | 'weibo' | 'article';
export type ActivityExportFormat = 'json' | 'markdown';

export interface MarkdownTemplate {
  id: string;
  name: string;
  scope: MarkdownTemplateScope;
  frontmatter: string;
  body: string;
}

export interface SelectorProbe {
  name: string;
  selector: string;
  required: boolean;
  description: string;
}

export interface ProbeResult {
  name: string;
  found: boolean;
  selector: string;
}

export interface DiagnosticReport {
  platform: ExtractorPlatform;
  timestamp: string;
  url: string;
  probeResults: ProbeResult[];
  structureValid: boolean;
  fallbacksUsed: string[];
  error?: string;
}

export interface ClassificationSuggestion {
  bookmarkId: string;
  targetFolder: string;
  confidence: number;
  reason: ClassificationReason;
  ruleName?: string;
  tags: string[];
}

export interface MovePlan {
  id: string;
  bookmarkId: string;
  bookmarkTitle: string;
  bookmarkUrl: string;
  currentFolder: string;
  targetFolder: string;
  confidence: number;
  reason: ClassificationReason;
  ruleName?: string;
  tags: string[];
  selected: boolean;
}

export interface ClassificationPlan {
  mode: ClassificationMode;
  moves: MovePlan[];
  newFolders: string[];
  unchanged: number;
  totalBookmarks: number;
  generatedAt: string;
}

export interface ClassificationProgress {
  done: number;
  total: number;
  batch: number;
  totalBatches: number;
  elapsedMs: number;
  remainingMs?: number;
  cancelled?: boolean;
}

export interface UrlHealthSummary {
  alive: number;
  redirected: number;
  dead: number;
  error: number;
  skipped: number;
}

export interface UrlHealthRecord {
  bookmarkId: string;
  bookmarkTitle: string;
  bookmarkUrl: string;
  parentPath: string;
  status: UrlHealthStatus;
  checkedAt: string;
  durationMs: number;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
}

export interface UrlHealthProgress {
  done: number;
  total: number;
  elapsedMs: number;
  remainingMs?: number;
  currentUrl?: string;
  summary: UrlHealthSummary;
}

export const BOOKMARK_OPERATION_SCHEMA_VERSION = 1 as const;
export const BOOKMARK_OPERATION_BATCH_LIMIT = 250;
export const BOOKMARK_OPERATION_COMMAND_LIMIT = 64;
export const BOOKMARK_OPERATION_JOURNAL_LIMIT = 100;
export const BOOKMARK_OPERATION_MAX_BYTES = 512 * 1_024;
export const BOOKMARK_OPERATION_JOURNAL_MAX_BYTES = 4 * 1_024 * 1_024;
export const BOOKMARK_OPERATION_RESERVE_BASE_BYTES = 64 * 1_024;
export const BOOKMARK_OPERATION_RESERVE_ITEM_BYTES = 1_024;
export const BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT = 2;

export const BOOKMARK_OPERATION_LIMITS = {
  requestId: 128,
  operationId: 160,
  bookmarkId: 128,
  title: 1_024,
  url: 8_192,
  targetPath: 512,
  targetSegment: 128,
  targetDepth: 16,
  duplicateBaselineIds: 250,
  attemptCount: 64,
} as const;

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function boundedString(maxLength: number, minLength = 0): z.ZodString {
  return z.string().min(minLength).max(maxLength);
}

function jsonUtf8ByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isSafeBookmarkHttpUrl(value: string): boolean {
  if (
    value !== value.trim() ||
    value.includes('\\') ||
    hasControlCharacters(value) ||
    value.length > BOOKMARK_OPERATION_LIMITS.url
  ) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

export function normalizeBookmarkOperationUrl(value: string): string {
  if (!isSafeBookmarkHttpUrl(value)) {
    throw new Error('只允许不含凭据的 http/https 书签链接');
  }
  return new URL(value).href;
}

export function normalizeBookmarkTargetPath(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || hasControlCharacters(value)) {
    throw new Error('无效的书签目标目录');
  }

  const rawSegments = value.normalize('NFC').replaceAll('\\', '/').split('/');
  const segments = rawSegments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (
    segments.length === 0 ||
    segments.length > BOOKMARK_OPERATION_LIMITS.targetDepth ||
    segments.some(
      (segment) =>
        segment === '.' ||
        segment === '..' ||
        segment.length > BOOKMARK_OPERATION_LIMITS.targetSegment,
    )
  ) {
    throw new Error('无效的书签目标目录');
  }

  const normalized = segments.join('/');
  if (normalized.length > BOOKMARK_OPERATION_LIMITS.targetPath) {
    throw new Error('书签目标目录过长');
  }
  return normalized;
}

export function assertBookmarkOperationRequestId(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > BOOKMARK_OPERATION_LIMITS.requestId ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw new Error('无效的书签操作 requestId');
  }
}

async function sha256Digest(canonicalPayload: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalPayload),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

export interface BookmarkUrlUpdateRequestItem {
  id: string;
  url: string;
}

export interface BookmarkMoveRequestItem {
  bookmarkId: string;
  targetFolder: string;
  targetIndex?: number;
}

export async function createBookmarkExecutionPayloadIdentity(
  type: BookmarkOperationType,
  items:
    | readonly string[]
    | readonly BookmarkUrlUpdateRequestItem[]
    | readonly BookmarkMoveRequestItem[],
  source: BookmarkOperationSource,
): Promise<string> {
  let canonicalItems: unknown[];
  if (type === 'delete_bookmarks') {
    canonicalItems = [...(items as readonly string[])];
  } else if (type === 'update_bookmark_urls') {
    canonicalItems = (items as readonly BookmarkUrlUpdateRequestItem[]).map((item) => [
      item.id,
      normalizeBookmarkOperationUrl(item.url),
    ]);
  } else {
    canonicalItems = (items as readonly BookmarkMoveRequestItem[]).map((item) => [
      item.bookmarkId,
      normalizeBookmarkTargetPath(item.targetFolder),
      item.targetIndex ?? null,
    ]);
  }

  return sha256Digest(JSON.stringify(['execute', type, source, canonicalItems]));
}

export type BookmarkOperationCommandAction = 'execute' | 'restore' | 'accept_current' | 'cancel';

export function createBookmarkCommandPayloadIdentity(
  action: Exclude<BookmarkOperationCommandAction, 'execute'>,
  operationId: string,
): Promise<string> {
  return sha256Digest(JSON.stringify(['command', action, operationId]));
}

export type BookmarkOperationType = 'delete_bookmarks' | 'update_bookmark_urls' | 'move_bookmarks';
export type BookmarkOperationSource = 'health' | 'classification' | 'manual';
export type BookmarkOperationStatus =
  | 'prepared'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'restoring'
  | 'restored'
  | 'restore_partial'
  | 'resolved';
export type BookmarkOperationItemStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'conflict';
export type BookmarkOperationRestoreStatus =
  | 'not_needed'
  | 'pending'
  | 'restored'
  | 'restore_failed'
  | 'conflict'
  | 'accepted_current';
export const BOOKMARK_OPERATION_STORAGE_ERROR_CODES = [
  'journal_corrupt',
  'journal_revision_conflict',
  'journal_capacity_exceeded',
  'journal_reserve_exceeded',
  'operation_too_large',
  'journal_too_large',
  'storage_read_failed',
  'storage_write_failed',
] as const;

export const BOOKMARK_OPERATION_COMMAND_ERROR_CODES = [
  'invalid_request',
  'request_id_conflict',
  'command_limit_exceeded',
  'operation_not_found',
  'invalid_operation_state',
  'operation_busy',
  'attempt_limit_exceeded',
] as const;

export const BOOKMARK_OPERATION_ITEM_ERROR_CODES = [
  'bookmark_not_found',
  'not_a_bookmark',
  'invalid_bookmark_data',
  'bookmark_changed',
  'already_target',
  'invalid_url',
  'invalid_target_path',
  'target_folder_error',
  'target_folder_conflict',
  'chrome_api_error',
  'state_read_failed',
  'callback_binding_failed',
  'verification_failed',
  'mutation_failed',
  'operation_interrupted',
  'operation_cancelled',
  'conflict_stopped',
  'duplicate_detected',
  'duplicate_ambiguous',
  'parent_recovery_failed',
  'restore_conflict',
] as const;

export type BookmarkOperationStorageErrorCode =
  (typeof BOOKMARK_OPERATION_STORAGE_ERROR_CODES)[number];
export type BookmarkOperationCommandErrorCode =
  (typeof BOOKMARK_OPERATION_COMMAND_ERROR_CODES)[number];
export type BookmarkOperationItemErrorCode = (typeof BOOKMARK_OPERATION_ITEM_ERROR_CODES)[number];
export type BookmarkOperationErrorCode =
  | BookmarkOperationStorageErrorCode
  | BookmarkOperationCommandErrorCode
  | BookmarkOperationItemErrorCode;
export type BookmarkFolderResolutionStatus =
  | 'existing'
  | 'attempted'
  | 'created'
  | 'reconciled'
  | 'failed'
  | 'conflict';
export type BookmarkMoveTargetStatus = 'pending' | 'resolving' | 'resolved' | 'failed' | 'conflict';
export type BookmarkOperationCommandStatus = 'pending' | 'succeeded' | 'failed';

export interface BookmarkOperationSummary {
  requested: number;
  pending: number;
  succeeded: number;
  failed: number;
  skipped: number;
  executionConflicts: number;
  restorePending: number;
  restored: number;
  restoreFailed: number;
  restoreConflicts: number;
  acceptedCurrent: number;
}

export interface BookmarkSnapshot {
  title: string;
  url: string;
  parentId: string;
  index: number;
}

export interface BookmarkFolderResolutionRecord {
  path: string;
  title: string;
  parentId: string;
  baselineIds: string[];
  status: BookmarkFolderResolutionStatus;
  folderId?: string;
  callbackId?: string;
  attemptedAt?: string;
  attemptCount: number;
  errorCode?: BookmarkOperationErrorCode;
}

interface BookmarkOperationItemBase {
  bookmarkId: string;
  title: string;
  executionStatus: BookmarkOperationItemStatus;
  restoreStatus: BookmarkOperationRestoreStatus;
  errorCode?: BookmarkOperationErrorCode;
  restoreErrorCode?: BookmarkOperationErrorCode;
  executionAttemptedAt?: string;
  executionCompletedAt?: string;
  executionAttemptCount: number;
  restoreAttemptedAt?: string;
  restoreCompletedAt?: string;
  restoreAttemptCount: number;
}

export interface DeleteBookmarkOperationItem extends BookmarkOperationItemBase {
  kind: 'delete';
  original?: BookmarkSnapshot;
  matchingCountBefore?: number;
  restoreBaselineBookmarkIds?: string[];
  restoreTargetParentId?: string;
  restoredBookmarkId?: string;
  restoredParentId?: string;
}

export interface UpdateBookmarkUrlOperationItem extends BookmarkOperationItemBase {
  kind: 'update_url';
  original?: BookmarkSnapshot;
  oldUrl?: string;
  newUrl: string;
}

export interface MoveBookmarkOperationItem extends BookmarkOperationItemBase {
  kind: 'move';
  original?: BookmarkSnapshot;
  targetFolder: string;
  requestedTargetIndex?: number;
  targetParentId?: string;
  actualTargetIndex?: number;
  targetStatus: BookmarkMoveTargetStatus;
  targetErrorCode?: BookmarkOperationErrorCode;
  folderResolution: BookmarkFolderResolutionRecord[];
}

export type BookmarkOperationItem =
  | DeleteBookmarkOperationItem
  | UpdateBookmarkUrlOperationItem
  | MoveBookmarkOperationItem;

export function bookmarkOperationItemNeedsRestore(item: BookmarkOperationItem): boolean {
  return (
    item.executionStatus === 'succeeded' &&
    item.restoreStatus !== 'restored' &&
    item.restoreStatus !== 'accepted_current' &&
    (item.restoreStatus === 'pending' ||
      item.restoreAttemptCount < BOOKMARK_OPERATION_LIMITS.attemptCount)
  );
}

export interface BookmarkOperationCommandResult {
  ok: boolean;
  operationStatus: BookmarkOperationStatus;
  summary: BookmarkOperationSummary;
  completedAt: string;
  errorCode?: BookmarkOperationErrorCode;
}

export interface BookmarkOperationCommandRecord {
  requestId: string;
  action: BookmarkOperationCommandAction;
  payloadIdentity: string;
  status: BookmarkOperationCommandStatus;
  createdAt: string;
  updatedAt: string;
  result?: BookmarkOperationCommandResult;
}

export interface BookmarkOperation {
  id: string;
  requestId: string;
  payloadIdentity: string;
  version: typeof BOOKMARK_OPERATION_SCHEMA_VERSION;
  type: BookmarkOperationType;
  status: BookmarkOperationStatus;
  source: BookmarkOperationSource;
  createdAt: string;
  updatedAt: string;
  requestedCount: number;
  items: BookmarkOperationItem[];
  summary: BookmarkOperationSummary;
  commands: BookmarkOperationCommandRecord[];
  recoveryFolder?: BookmarkFolderResolutionRecord;
}

export interface BookmarkOperationJournalEnvelope {
  version: typeof BOOKMARK_OPERATION_SCHEMA_VERSION;
  revision: number;
  operations: BookmarkOperation[];
}

export interface BookmarkOperationCommandResponse {
  receipt: BookmarkOperationCommandRecord & {
    status: 'succeeded' | 'failed';
    result: BookmarkOperationCommandResult;
  };
  operation: BookmarkOperation;
}

export type BookmarkOperationEvent = {
  type: 'bookmarkOperations:progress';
  operation: BookmarkOperation;
};

const requestIdSchema = boundedString(BOOKMARK_OPERATION_LIMITS.requestId, 8).regex(
  SAFE_ID_PATTERN,
);
const operationIdSchema = boundedString(BOOKMARK_OPERATION_LIMITS.operationId, 8).regex(
  SAFE_ID_PATTERN,
);
const bookmarkIdSchema = boundedString(BOOKMARK_OPERATION_LIMITS.bookmarkId, 1).regex(
  SAFE_ID_PATTERN,
);
const titleSchema = boundedString(BOOKMARK_OPERATION_LIMITS.title);
const isoTimestampSchema = boundedString(40, 20).refine(isIsoTimestamp);
const indexSchema = z.number().int().min(0).max(1_000_000);
const attemptCountSchema = z.number().int().min(0).max(BOOKMARK_OPERATION_LIMITS.attemptCount);
const bookmarkUrlSchema = boundedString(BOOKMARK_OPERATION_LIMITS.url, 1).refine(
  isSafeBookmarkHttpUrl,
);
const targetPathSchema = boundedString(BOOKMARK_OPERATION_LIMITS.targetPath, 1).refine((value) => {
  try {
    return normalizeBookmarkTargetPath(value) === value;
  } catch {
    return false;
  }
});
const payloadIdentitySchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const BookmarkOperationStorageErrorCodeSchema = z.enum(
  BOOKMARK_OPERATION_STORAGE_ERROR_CODES,
);
export const BookmarkOperationCommandErrorCodeSchema = z.enum(
  BOOKMARK_OPERATION_COMMAND_ERROR_CODES,
);
export const BookmarkOperationItemErrorCodeSchema = z.enum(BOOKMARK_OPERATION_ITEM_ERROR_CODES);
export const BookmarkOperationErrorCodeSchema = z.union([
  BookmarkOperationStorageErrorCodeSchema,
  BookmarkOperationCommandErrorCodeSchema,
  BookmarkOperationItemErrorCodeSchema,
]);
const errorCodeSchema = BookmarkOperationErrorCodeSchema;
const operationStatusSchema = z.enum([
  'prepared',
  'running',
  'complete',
  'partial',
  'failed',
  'cancelled',
  'restoring',
  'restored',
  'restore_partial',
  'resolved',
]);
const itemStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'skipped', 'conflict']);
const restoreStatusSchema = z.enum([
  'not_needed',
  'pending',
  'restored',
  'restore_failed',
  'conflict',
  'accepted_current',
]);

export const BookmarkUrlUpdateRequestItemSchema = z.strictObject({
  id: bookmarkIdSchema,
  url: bookmarkUrlSchema,
});

export const BookmarkMoveRequestItemSchema = z.strictObject({
  bookmarkId: bookmarkIdSchema,
  targetFolder: targetPathSchema,
  targetIndex: indexSchema.optional(),
});

const bookmarkSnapshotSchema = z.strictObject({
  title: titleSchema,
  url: bookmarkUrlSchema,
  parentId: bookmarkIdSchema,
  index: indexSchema,
});

export const BookmarkFolderResolutionRecordSchema = z.strictObject({
  path: targetPathSchema,
  title: boundedString(BOOKMARK_OPERATION_LIMITS.targetSegment, 1),
  parentId: bookmarkIdSchema,
  baselineIds: z.array(bookmarkIdSchema).max(BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT),
  status: z.enum(['existing', 'attempted', 'created', 'reconciled', 'failed', 'conflict']),
  folderId: bookmarkIdSchema.optional(),
  callbackId: bookmarkIdSchema.optional(),
  attemptedAt: isoTimestampSchema.optional(),
  attemptCount: attemptCountSchema,
  errorCode: errorCodeSchema.optional(),
});
const folderResolutionRecordSchema = BookmarkFolderResolutionRecordSchema;

const operationItemBaseShape = {
  bookmarkId: bookmarkIdSchema,
  title: titleSchema,
  executionStatus: itemStatusSchema,
  restoreStatus: restoreStatusSchema,
  errorCode: errorCodeSchema.optional(),
  restoreErrorCode: errorCodeSchema.optional(),
  executionAttemptedAt: isoTimestampSchema.optional(),
  executionCompletedAt: isoTimestampSchema.optional(),
  executionAttemptCount: attemptCountSchema,
  restoreAttemptedAt: isoTimestampSchema.optional(),
  restoreCompletedAt: isoTimestampSchema.optional(),
  restoreAttemptCount: attemptCountSchema,
};

const deleteOperationItemSchema = z.strictObject({
  ...operationItemBaseShape,
  kind: z.literal('delete'),
  original: bookmarkSnapshotSchema.optional(),
  matchingCountBefore: z.number().int().min(1).max(1_000_000).optional(),
  restoreBaselineBookmarkIds: z
    .array(bookmarkIdSchema)
    .max(BOOKMARK_OPERATION_LIMITS.duplicateBaselineIds)
    .optional(),
  restoreTargetParentId: bookmarkIdSchema.optional(),
  restoredBookmarkId: bookmarkIdSchema.optional(),
  restoredParentId: bookmarkIdSchema.optional(),
});

const updateOperationItemSchema = z.strictObject({
  ...operationItemBaseShape,
  kind: z.literal('update_url'),
  original: bookmarkSnapshotSchema.optional(),
  oldUrl: bookmarkUrlSchema.optional(),
  newUrl: bookmarkUrlSchema,
});

const moveOperationItemSchema = z.strictObject({
  ...operationItemBaseShape,
  kind: z.literal('move'),
  original: bookmarkSnapshotSchema.optional(),
  targetFolder: targetPathSchema,
  requestedTargetIndex: indexSchema.optional(),
  targetParentId: bookmarkIdSchema.optional(),
  actualTargetIndex: indexSchema.optional(),
  targetStatus: z.enum(['pending', 'resolving', 'resolved', 'failed', 'conflict']),
  targetErrorCode: errorCodeSchema.optional(),
  folderResolution: z
    .array(folderResolutionRecordSchema)
    .max(BOOKMARK_OPERATION_LIMITS.targetDepth),
});

const operationItemSchema = z.discriminatedUnion('kind', [
  deleteOperationItemSchema,
  updateOperationItemSchema,
  moveOperationItemSchema,
]);

export const BookmarkOperationSummarySchema = z.strictObject({
  requested: z.number().int().min(1).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  pending: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  succeeded: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  failed: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  skipped: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  executionConflicts: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  restorePending: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  restored: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  restoreFailed: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  restoreConflicts: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  acceptedCurrent: z.number().int().min(0).max(BOOKMARK_OPERATION_BATCH_LIMIT),
});
const operationSummarySchema = BookmarkOperationSummarySchema;

export const BookmarkOperationCommandResultSchema = z.strictObject({
  ok: z.boolean(),
  operationStatus: operationStatusSchema,
  summary: operationSummarySchema,
  completedAt: isoTimestampSchema,
  errorCode: errorCodeSchema.optional(),
});
const commandResultSchema = BookmarkOperationCommandResultSchema;

export const BookmarkOperationCommandReceiptSchema = z.strictObject({
  requestId: requestIdSchema,
  action: z.enum(['execute', 'restore', 'accept_current', 'cancel']),
  payloadIdentity: payloadIdentitySchema,
  status: z.enum(['pending', 'succeeded', 'failed']),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  result: commandResultSchema.optional(),
});
const commandRecordSchema = BookmarkOperationCommandReceiptSchema;

export const TerminalBookmarkOperationCommandReceiptSchema =
  BookmarkOperationCommandReceiptSchema.superRefine((receipt, context) => {
    if (receipt.status === 'pending' || !receipt.result) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Command receipt is not terminal',
      });
    }
  }).transform((receipt) => receipt as BookmarkOperationCommandResponse['receipt']);

export function summarizeBookmarkOperationItems(
  items: readonly BookmarkOperationItem[],
): BookmarkOperationSummary {
  return {
    requested: items.length,
    pending: items.filter((item) => item.executionStatus === 'pending').length,
    succeeded: items.filter((item) => item.executionStatus === 'succeeded').length,
    failed: items.filter((item) => item.executionStatus === 'failed').length,
    skipped: items.filter((item) => item.executionStatus === 'skipped').length,
    executionConflicts: items.filter((item) => item.executionStatus === 'conflict').length,
    restorePending: items.filter((item) => item.restoreStatus === 'pending').length,
    restored: items.filter((item) => item.restoreStatus === 'restored').length,
    restoreFailed: items.filter((item) => item.restoreStatus === 'restore_failed').length,
    restoreConflicts: items.filter((item) => item.restoreStatus === 'conflict').length,
    acceptedCurrent: items.filter((item) => item.restoreStatus === 'accepted_current').length,
  };
}

function summariesMatch(left: BookmarkOperationSummary, right: BookmarkOperationSummary): boolean {
  return (Object.keys(left) as Array<keyof BookmarkOperationSummary>).every(
    (key) => left[key] === right[key],
  );
}

function summaryIsBalanced(summary: BookmarkOperationSummary): boolean {
  return (
    summary.pending +
      summary.succeeded +
      summary.failed +
      summary.skipped +
      summary.executionConflicts ===
      summary.requested &&
    summary.restorePending +
      summary.restored +
      summary.restoreFailed +
      summary.restoreConflicts +
      summary.acceptedCurrent ===
      summary.succeeded
  );
}

function validateFolderResolutionRecord(
  record: BookmarkFolderResolutionRecord,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const noAttempt = record.attemptCount === 0 && record.attemptedAt === undefined;
  const hasAttempt = record.attemptCount > 0 && record.attemptedAt !== undefined;
  const baselineUnique = new Set(record.baselineIds).size === record.baselineIds.length;
  const valid =
    (record.status === 'existing' &&
      noAttempt &&
      record.baselineIds.length === 1 &&
      record.folderId !== undefined &&
      record.folderId === record.baselineIds[0] &&
      record.callbackId === undefined &&
      record.errorCode === undefined) ||
    (record.status === 'attempted' &&
      hasAttempt &&
      record.baselineIds.length === 0 &&
      record.folderId === undefined &&
      record.callbackId === undefined &&
      record.errorCode === undefined) ||
    (record.status === 'created' &&
      hasAttempt &&
      record.baselineIds.length === 0 &&
      record.folderId !== undefined &&
      record.callbackId === record.folderId &&
      record.errorCode === undefined) ||
    (record.status === 'reconciled' &&
      hasAttempt &&
      record.baselineIds.length === 0 &&
      record.folderId !== undefined &&
      record.callbackId === undefined &&
      record.errorCode === undefined) ||
    ((record.status === 'failed' || record.status === 'conflict') &&
      record.folderId === undefined &&
      record.callbackId === undefined &&
      record.errorCode !== undefined &&
      ((hasAttempt && record.baselineIds.length === 0) ||
        (noAttempt &&
          record.status === 'conflict' &&
          record.baselineIds.length === BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT)));

  if (!valid || !baselineUnique) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Invalid folder resolution evidence',
    });
  }
}

function validateOperationItem(
  item: BookmarkOperationItem,
  context: z.RefinementCtx,
  index: number,
): void {
  const path = ['items', index];
  const executionHasAttempt =
    item.executionAttemptCount > 0 && item.executionAttemptedAt !== undefined;
  const executionHasNoAttempt =
    item.executionAttemptCount === 0 && item.executionAttemptedAt === undefined;
  const executionCompleted = item.executionCompletedAt !== undefined;

  if (
    !(executionHasAttempt || executionHasNoAttempt) ||
    (item.executionStatus === 'pending' && (executionCompleted || item.errorCode !== undefined)) ||
    (item.executionStatus === 'succeeded' &&
      (!executionHasAttempt || !executionCompleted || item.errorCode !== undefined)) ||
    ((item.executionStatus === 'failed' ||
      item.executionStatus === 'skipped' ||
      item.executionStatus === 'conflict') &&
      (!executionCompleted || item.errorCode === undefined))
  ) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Invalid execution evidence',
    });
  }

  const restoreHasAttempt = item.restoreAttemptCount > 0 && item.restoreAttemptedAt !== undefined;
  const restoreHasNoAttempt =
    item.restoreAttemptCount === 0 && item.restoreAttemptedAt === undefined;
  const restoreCompleted = item.restoreCompletedAt !== undefined;
  const cancelledWithoutAttempt =
    item.restoreStatus === 'restore_failed' &&
    restoreHasNoAttempt &&
    (item.restoreErrorCode === 'operation_cancelled' ||
      item.restoreErrorCode === 'operation_interrupted');

  if (
    !(restoreHasAttempt || restoreHasNoAttempt) ||
    (item.restoreStatus === 'not_needed' &&
      (!restoreHasNoAttempt || restoreCompleted || item.restoreErrorCode !== undefined)) ||
    (item.restoreStatus === 'pending' &&
      (restoreCompleted || item.restoreErrorCode !== undefined)) ||
    (item.restoreStatus === 'restored' &&
      (!restoreHasAttempt || !restoreCompleted || item.restoreErrorCode !== undefined)) ||
    (item.restoreStatus === 'restore_failed' &&
      !cancelledWithoutAttempt &&
      (!restoreHasAttempt || !restoreCompleted || item.restoreErrorCode === undefined)) ||
    (item.restoreStatus === 'conflict' &&
      (!restoreCompleted || item.restoreErrorCode === undefined)) ||
    (item.restoreStatus === 'accepted_current' &&
      (!restoreCompleted || item.restoreErrorCode !== undefined))
  ) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Invalid restore evidence',
    });
  }

  if (
    (item.executionStatus === 'succeeded' && item.restoreStatus === 'not_needed') ||
    (item.executionStatus !== 'succeeded' && item.restoreStatus !== 'not_needed')
  ) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Invalid restore eligibility',
    });
  }

  if (item.kind === 'delete') {
    const validOriginal =
      item.executionStatus === 'failed' && item.executionAttemptCount === 0
        ? true
        : item.original !== undefined &&
          item.restoreBaselineBookmarkIds !== undefined &&
          item.matchingCountBefore === item.restoreBaselineBookmarkIds.length &&
          item.restoreBaselineBookmarkIds.includes(item.bookmarkId) &&
          item.title === item.original.title;
    const validRestoredIdentity =
      item.restoreStatus !== 'restored' ||
      (item.restoredBookmarkId !== undefined &&
        item.restoredParentId !== undefined &&
        item.restoreTargetParentId === item.restoredParentId);
    const baselineUnique =
      item.restoreBaselineBookmarkIds === undefined ||
      new Set(item.restoreBaselineBookmarkIds).size === item.restoreBaselineBookmarkIds.length;
    if (!validOriginal || !validRestoredIdentity || !baselineUnique) {
      context.addIssue({ code: 'custom', path, message: 'Invalid delete inverse data' });
    }
    return;
  }

  if (item.kind === 'update_url') {
    if (
      ((item.executionStatus === 'pending' ||
        item.executionStatus === 'succeeded' ||
        item.executionAttemptCount > 0) &&
        (item.original === undefined ||
          item.oldUrl === undefined ||
          item.original.url !== item.oldUrl ||
          item.original.title !== item.title)) ||
      (item.oldUrl !== undefined &&
        item.original !== undefined &&
        item.oldUrl !== item.original.url)
    ) {
      context.addIssue({ code: 'custom', path, message: 'Invalid URL inverse data' });
    }
    return;
  }

  item.folderResolution.forEach((record, recordIndex) =>
    validateFolderResolutionRecord(record, context, [...path, 'folderResolution', recordIndex]),
  );
  const resolutionPaths = item.folderResolution.map((record) => record.path);
  const uniqueResolutionPaths = new Set(resolutionPaths).size === resolutionPaths.length;
  const resolvedTargetIsValid =
    item.targetStatus !== 'resolved' ||
    (item.targetParentId !== undefined && item.targetErrorCode === undefined);
  const failedTargetIsValid =
    (item.targetStatus !== 'failed' && item.targetStatus !== 'conflict') ||
    item.targetErrorCode !== undefined;
  const successfulMoveIsValid =
    (item.executionStatus !== 'pending' &&
      item.executionStatus !== 'succeeded' &&
      item.executionAttemptCount === 0) ||
    (item.original !== undefined &&
      item.original.title === item.title &&
      (item.executionStatus !== 'succeeded' ||
        (item.targetStatus === 'resolved' &&
          item.targetParentId !== undefined &&
          item.actualTargetIndex !== undefined)));
  const attemptedMoveHasTarget =
    item.executionAttemptCount === 0 ||
    (item.targetStatus === 'resolved' && item.targetParentId !== undefined);
  if (
    !uniqueResolutionPaths ||
    !resolvedTargetIsValid ||
    !failedTargetIsValid ||
    !successfulMoveIsValid ||
    !attemptedMoveHasTarget
  ) {
    context.addIssue({ code: 'custom', path, message: 'Invalid move journal data' });
  }
}

function validateOperationStatus(operation: BookmarkOperation, context: z.RefinementCtx): void {
  const successful = operation.items.filter((item) => item.executionStatus === 'succeeded');
  const executionSettled = operation.items.every((item) => item.executionStatus !== 'pending');
  const restoreSettled = successful.every((item) => item.restoreStatus !== 'pending');
  const executionProblems = operation.items.filter(
    (item) =>
      item.executionStatus === 'failed' ||
      item.executionStatus === 'conflict' ||
      (item.executionStatus === 'skipped' && item.errorCode !== 'already_target'),
  );
  let valid = false;

  switch (operation.status) {
    case 'prepared':
      valid = successful.length === 0;
      break;
    case 'running':
      valid = true;
      break;
    case 'complete':
      valid =
        executionSettled &&
        executionProblems.length === 0 &&
        successful.every((item) => item.restoreStatus === 'pending');
      break;
    case 'partial':
      valid =
        executionSettled &&
        successful.length > 0 &&
        executionProblems.length > 0 &&
        successful.every((item) => item.restoreStatus === 'pending');
      break;
    case 'failed':
      valid =
        executionSettled &&
        successful.length === 0 &&
        operation.items.some(
          (item) => item.executionStatus === 'failed' || item.executionStatus === 'conflict',
        );
      break;
    case 'cancelled':
      valid =
        executionSettled &&
        successful.length === 0 &&
        operation.items.some((item) => item.errorCode === 'operation_cancelled');
      break;
    case 'restoring':
      valid = executionSettled && successful.length > 0;
      break;
    case 'restored':
      valid =
        executionSettled &&
        successful.length > 0 &&
        successful.every((item) => item.restoreStatus === 'restored');
      break;
    case 'restore_partial':
      valid =
        executionSettled &&
        successful.length > 0 &&
        successful.some(
          (item) =>
            item.restoreStatus === 'pending' ||
            item.restoreStatus === 'restore_failed' ||
            item.restoreStatus === 'conflict',
        );
      break;
    case 'resolved':
      valid =
        executionSettled &&
        restoreSettled &&
        successful.length > 0 &&
        successful.some((item) => item.restoreStatus === 'accepted_current') &&
        successful.every(
          (item) => item.restoreStatus === 'restored' || item.restoreStatus === 'accepted_current',
        );
      break;
  }

  if (!valid) {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Operation status does not match item state',
    });
  }
}

function commandResultMatchesAction(command: BookmarkOperationCommandRecord): boolean {
  if (command.status !== 'succeeded' || !command.result) {
    return true;
  }

  switch (command.action) {
    case 'execute':
      return ['complete', 'partial', 'failed', 'cancelled'].includes(
        command.result.operationStatus,
      );
    case 'restore':
      return ['restored', 'restore_partial', 'resolved'].includes(command.result.operationStatus);
    case 'accept_current':
      return ['resolved', 'restore_partial'].includes(command.result.operationStatus);
    case 'cancel':
      return !['prepared', 'running', 'restoring'].includes(command.result.operationStatus);
  }
}

function commandResultSummaryMatchesStatus(command: BookmarkOperationCommandRecord): boolean {
  if (command.status !== 'succeeded' || !command.result) {
    return true;
  }
  const { operationStatus, summary } = command.result;
  const executionProblems = summary.failed + summary.executionConflicts + summary.skipped;

  switch (operationStatus) {
    case 'complete':
      return summary.pending === 0 && summary.failed === 0 && summary.executionConflicts === 0;
    case 'partial':
      return summary.pending === 0 && summary.succeeded > 0 && executionProblems > 0;
    case 'failed':
      return (
        summary.pending === 0 &&
        summary.succeeded === 0 &&
        summary.failed + summary.executionConflicts > 0
      );
    case 'cancelled':
      return summary.pending === 0 && summary.succeeded === 0 && summary.skipped > 0;
    case 'restored':
      return (
        summary.succeeded > 0 &&
        summary.restorePending === 0 &&
        summary.restoreFailed === 0 &&
        summary.restoreConflicts === 0 &&
        summary.acceptedCurrent === 0 &&
        summary.restored === summary.succeeded
      );
    case 'restore_partial':
      return (
        summary.succeeded > 0 &&
        (summary.restorePending > 0 || summary.restoreFailed > 0 || summary.restoreConflicts > 0)
      );
    case 'resolved':
      return (
        summary.succeeded > 0 &&
        summary.restorePending === 0 &&
        summary.restoreFailed === 0 &&
        summary.restoreConflicts === 0 &&
        summary.acceptedCurrent > 0 &&
        summary.restored + summary.acceptedCurrent === summary.succeeded
      );
    case 'prepared':
    case 'running':
    case 'restoring':
      return false;
  }
}

function executionResultStatus(
  items: readonly BookmarkOperationItem[],
): 'complete' | 'partial' | 'failed' | 'cancelled' {
  const succeeded = items.filter((item) => item.executionStatus === 'succeeded').length;
  const problems = items.filter(
    (item) =>
      item.executionStatus === 'failed' ||
      item.executionStatus === 'conflict' ||
      (item.executionStatus === 'skipped' && item.errorCode !== 'already_target'),
  ).length;
  const cancelled = items.some((item) => item.errorCode === 'operation_cancelled');
  if (succeeded === 0 && cancelled) {
    return 'cancelled';
  }
  if (succeeded === 0 && problems > 0) {
    return 'failed';
  }
  return problems > 0 ? 'partial' : 'complete';
}

const bookmarkOperationObjectSchema = z.strictObject({
  id: operationIdSchema,
  requestId: requestIdSchema,
  payloadIdentity: payloadIdentitySchema,
  version: z.literal(BOOKMARK_OPERATION_SCHEMA_VERSION),
  type: z.enum(['delete_bookmarks', 'update_bookmark_urls', 'move_bookmarks']),
  status: operationStatusSchema,
  source: z.enum(['health', 'classification', 'manual']),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  requestedCount: z.number().int().min(1).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  items: z.array(operationItemSchema).min(1).max(BOOKMARK_OPERATION_BATCH_LIMIT),
  summary: operationSummarySchema,
  commands: z.array(commandRecordSchema).min(1).max(BOOKMARK_OPERATION_COMMAND_LIMIT),
  recoveryFolder: folderResolutionRecordSchema.optional(),
});

export const BookmarkOperationSchema = bookmarkOperationObjectSchema.superRefine(
  (operation, context) => {
    if (jsonUtf8ByteLength(operation) > BOOKMARK_OPERATION_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'operation_too_large',
      });
    }
    if (
      operation.requestedCount !== operation.items.length ||
      !summariesMatch(operation.summary, summarizeBookmarkOperationItems(operation.items))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'Operation summary is inconsistent',
      });
    }

    if (new Set(operation.items.map((item) => item.bookmarkId)).size !== operation.items.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Bookmark IDs must be unique',
      });
    }

    const expectedKind =
      operation.type === 'delete_bookmarks'
        ? 'delete'
        : operation.type === 'update_bookmark_urls'
          ? 'update_url'
          : 'move';
    if (operation.items.some((item) => item.kind !== expectedKind)) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Operation type and item kind do not match',
      });
    }

    const commandRequestIds = operation.commands.map((command) => command.requestId);
    if (new Set(commandRequestIds).size !== commandRequestIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['commands'],
        message: 'Command request IDs must be unique',
      });
    }
    const pendingCommands = operation.commands.filter((command) => command.status === 'pending');
    if (
      pendingCommands.length > 2 ||
      (pendingCommands.length === 2 &&
        !(
          pendingCommands.some(
            (command) => command.action === 'execute' || command.action === 'restore',
          ) && pendingCommands.some((command) => command.action === 'cancel')
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commands'],
        message: 'Invalid concurrent command receipts',
      });
    }

    const executeCommand = operation.commands[0];
    if (
      !executeCommand ||
      executeCommand.action !== 'execute' ||
      executeCommand.requestId !== operation.requestId ||
      executeCommand.payloadIdentity !== operation.payloadIdentity
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commands', 0],
        message: 'The first command must bind the execution request',
      });
    }
    if (
      executeCommand?.status !== 'pending' &&
      executeCommand?.result &&
      (executeCommand.result.operationStatus !== executionResultStatus(operation.items) ||
        executeCommand.result.summary.pending !== operation.summary.pending ||
        executeCommand.result.summary.succeeded !== operation.summary.succeeded ||
        executeCommand.result.summary.failed !== operation.summary.failed ||
        executeCommand.result.summary.skipped !== operation.summary.skipped ||
        executeCommand.result.summary.executionConflicts !== operation.summary.executionConflicts)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commands', 0, 'result'],
        message: 'Execution receipt does not match immutable execution results',
      });
    }
    if (
      ((operation.status === 'prepared' || operation.status === 'running') &&
        executeCommand?.status !== 'pending') ||
      (operation.status !== 'prepared' &&
        operation.status !== 'running' &&
        executeCommand?.status === 'pending') ||
      (operation.status === 'restoring' &&
        !pendingCommands.some((command) => command.action === 'restore'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commands'],
        message: 'Pending commands do not match operation state',
      });
    }

    operation.commands.forEach((command, index) => {
      const resultMatchesStatus =
        (command.status === 'pending' && command.result === undefined) ||
        (command.status === 'succeeded' &&
          command.result?.ok === true &&
          command.result.errorCode === undefined) ||
        (command.status === 'failed' &&
          command.result?.ok === false &&
          command.result.errorCode !== undefined);
      if (
        (command.action === 'execute' && command.payloadIdentity !== operation.payloadIdentity) ||
        (command.action === 'execute' && index !== 0) ||
        !resultMatchesStatus ||
        !commandResultMatchesAction(command) ||
        !commandResultSummaryMatchesStatus(command) ||
        Date.parse(command.createdAt) < Date.parse(operation.createdAt) ||
        Date.parse(command.updatedAt) > Date.parse(operation.updatedAt) ||
        Date.parse(command.updatedAt) < Date.parse(command.createdAt) ||
        (command.result &&
          (command.result.completedAt !== command.updatedAt ||
            !summaryIsBalanced(command.result.summary) ||
            command.result.summary.requested !== operation.requestedCount))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['commands', index],
          message: 'Invalid command receipt',
        });
      }
    });

    if (
      Date.parse(operation.updatedAt) < Date.parse(operation.createdAt) ||
      (operation.recoveryFolder && operation.type !== 'delete_bookmarks')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Invalid operation metadata',
      });
    }

    if (operation.recoveryFolder) {
      validateFolderResolutionRecord(operation.recoveryFolder, context, ['recoveryFolder']);
    }
    operation.items.forEach((item, index) => validateOperationItem(item, context, index));
    validateOperationStatus(operation, context);
  },
);

export const BookmarkOperationCommandResponseSchema = z
  .strictObject({
    receipt: TerminalBookmarkOperationCommandReceiptSchema,
    operation: BookmarkOperationSchema,
  })
  .superRefine((response, context) => {
    const persisted = response.operation.commands.find(
      (command) => command.requestId === response.receipt.requestId,
    );
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(response.receipt)) {
      context.addIssue({
        code: 'custom',
        path: ['receipt'],
        message: 'Response receipt is not the persisted immutable receipt',
      });
    }
  });

export const BookmarkOperationJournalEnvelopeSchema = z
  .strictObject({
    version: z.literal(BOOKMARK_OPERATION_SCHEMA_VERSION),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    operations: z.array(BookmarkOperationSchema).max(BOOKMARK_OPERATION_JOURNAL_LIMIT),
  })
  .superRefine((envelope, context) => {
    if (jsonUtf8ByteLength(envelope) > BOOKMARK_OPERATION_JOURNAL_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'journal_too_large',
      });
    }
    const operationIds = envelope.operations.map((operation) => operation.id);
    const requestIds = envelope.operations.flatMap((operation) =>
      operation.commands.map((command) => command.requestId),
    );
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Operation IDs must be unique',
      });
    }
    if (new Set(requestIds).size !== requestIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Command request IDs must be globally unique',
      });
    }
  });
export const BookmarkOperationJournalSchema = BookmarkOperationJournalEnvelopeSchema;

export function isBookmarkOperation(value: unknown): value is BookmarkOperation {
  return BookmarkOperationSchema.safeParse(value).success;
}

export function parseBookmarkOperation(value: unknown): BookmarkOperation {
  const parsed = BookmarkOperationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('无效的书签操作日志');
  }
  return parsed.data;
}

export function parseBookmarkOperationJournalEnvelope(
  value: unknown,
): BookmarkOperationJournalEnvelope {
  const parsed = BookmarkOperationJournalEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('invalid_bookmark_operation_journal');
  }
  return parsed.data;
}

export function parseBookmarkOperationCommandResponse(
  value: unknown,
): BookmarkOperationCommandResponse {
  const parsed = BookmarkOperationCommandResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('invalid_bookmark_operation_command_response');
  }
  return parsed.data;
}

const uniqueBookmarkIdsSchema = z
  .array(bookmarkIdSchema)
  .min(1)
  .max(BOOKMARK_OPERATION_BATCH_LIMIT)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: '书签 id 不得重复' });
    }
  });

const uniqueUpdateItemsSchema = z
  .array(BookmarkUrlUpdateRequestItemSchema)
  .min(1)
  .max(BOOKMARK_OPERATION_BATCH_LIMIT)
  .superRefine((values, context) => {
    if (new Set(values.map((value) => value.id)).size !== values.length) {
      context.addIssue({ code: 'custom', message: '书签 id 不得重复' });
    }
  });

const uniqueMoveItemsSchema = z
  .array(BookmarkMoveRequestItemSchema)
  .min(1)
  .max(BOOKMARK_OPERATION_BATCH_LIMIT)
  .superRefine((values, context) => {
    if (new Set(values.map((value) => value.bookmarkId)).size !== values.length) {
      context.addIssue({ code: 'custom', message: '书签 id 不得重复' });
    }
  });

export const BookmarkOperationCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bookmarkOperations:delete'),
    requestId: requestIdSchema,
    bookmarkIds: uniqueBookmarkIdsSchema,
  }),
  z.strictObject({
    type: z.literal('bookmarkOperations:updateUrls'),
    requestId: requestIdSchema,
    updates: uniqueUpdateItemsSchema,
  }),
  z.strictObject({
    type: z.literal('bookmarkOperations:move'),
    requestId: requestIdSchema,
    moves: uniqueMoveItemsSchema,
  }),
  z.strictObject({
    type: z.literal('bookmarkOperations:restore'),
    requestId: requestIdSchema,
    operationId: operationIdSchema,
  }),
  z.strictObject({
    type: z.literal('bookmarkOperations:acceptCurrent'),
    requestId: requestIdSchema,
    operationId: operationIdSchema,
  }),
  z.strictObject({
    type: z.literal('bookmarkOperations:cancel'),
    requestId: requestIdSchema,
    operationId: operationIdSchema,
  }),
]);

export type BookmarkOperationCommand = z.infer<typeof BookmarkOperationCommandSchema>;

export function parseBookmarkOperationCommand(value: unknown): BookmarkOperationCommand {
  const parsed = BookmarkOperationCommandSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('无效的书签操作命令');
  }

  if (parsed.data.type === 'bookmarkOperations:updateUrls') {
    return {
      ...parsed.data,
      updates: parsed.data.updates.map((item) => ({
        id: item.id,
        url: normalizeBookmarkOperationUrl(item.url),
      })),
    };
  }
  if (parsed.data.type === 'bookmarkOperations:move') {
    return {
      ...parsed.data,
      moves: parsed.data.moves.map((item) => ({
        bookmarkId: item.bookmarkId,
        targetFolder: normalizeBookmarkTargetPath(item.targetFolder),
        ...(item.targetIndex === undefined ? {} : { targetIndex: item.targetIndex }),
      })),
    };
  }
  return parsed.data;
}

export type UrlHealthPortRequest =
  | { type: 'health:check'; bookmarkIds?: string[] }
  | { type: 'pause' }
  | { type: 'cancel' };

export type UrlHealthPortMessage =
  | { type: 'progress'; progress: UrlHealthProgress; records: UrlHealthRecord[] }
  | {
      type: 'complete';
      progress: UrlHealthProgress;
      records: UrlHealthRecord[];
      cancelled: boolean;
    }
  | { type: 'error'; error: string; errorCode?: string };

export type ClassificationPortRequest =
  | { type: 'plan:create'; mode: ClassificationMode }
  | { type: 'cancel' };

export type ClassificationPortMessage =
  | { type: 'progress'; progress: ClassificationProgress }
  | {
      type: 'complete';
      plan: ClassificationPlan;
      progress: ClassificationProgress;
      cancelled: boolean;
    }
  | { type: 'error'; error: string; errorCode?: string };

export interface MoveRecord {
  bookmarkId: string;
  bookmarkTitle: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
}

export interface ApplyFailure {
  bookmarkId: string;
  bookmarkTitle: string;
  error: string;
}

export interface ApplyResult {
  moved: number;
  failed: ApplyFailure[];
  backupKey: string;
  records: MoveRecord[];
}

export interface BackupRecord {
  key: string;
  createdAt: string;
  bookmarkCount: number;
  tree: BookmarkNode[];
}

export interface AppSettings {
  useAi: boolean;
  activeProviderId: string;
  aiProviders: AiProviderConfig[];
  customRules: CustomRule[];
  templates: MarkdownTemplate[];
  activeTemplateIds: Partial<Record<MarkdownTemplateScope, string>>;
  defaultClassifyMode: ClassificationMode;
  exportDirectory: string;
}

export type ExportManifestType = 'bookmark-index' | 'capture' | 'activity';

export interface ExportManifest {
  id: string;
  exportedAt: string;
  vaultPath: string;
  files: string[];
  fileLabels?: string[];
  bookmarkCount: number;
  type?: ExportManifestType;
  sourceLabel?: string;
}

export interface ExportPreviewFolder {
  path: string;
  count: number;
}

export interface ExportPreview {
  total: number;
  folders: ExportPreviewFolder[];
}

export interface CapturedMedia {
  type?: 'image' | 'video';
  url: string;
  alt?: string;
}

export interface CapturedContent {
  id: string;
  source: CaptureSource;
  title: string;
  url: string;
  author?: string;
  handle?: string;
  created?: string;
  text: string;
  media: CapturedMedia[];
  tags: string[];
  capturedAt: string;
  siteName?: string;
  description?: string;
  wordCount?: number;
}

export interface ExtensionState {
  tree: BookmarkNode[];
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  backups: BackupRecord[];
  exportManifests: ExportManifest[];
  pendingCaptures: CapturedContent[];
  urlHealthRecords: UrlHealthRecord[];
  bookmarkOperations: BookmarkOperation[];
  lastMoveRecordCount: number;
  onboarded: boolean;
  settings: AppSettings;
}

export interface StateSummary {
  bookmarkCount: number;
  folderCount: number;
  pendingCaptureCount: number;
  onboarded: boolean;
  hasVaultHandle: boolean;
  hasAiProvider: boolean;
  lastExportDate?: string;
}

export interface OnboardingProgressState {
  vaultConfigured: boolean;
  providerConfigured: boolean;
  firstClassifyDone: boolean;
  firstExportDone: boolean;
}

export type ExtensionRequest =
  | { type: 'state:get' }
  | { type: 'state:summary' }
  | { type: 'plan:create'; mode: ClassificationMode }
  | { type: 'settings:get' }
  | { type: 'settings:set'; settings: AppSettings }
  | { type: 'ai:testConnection'; provider: AiProviderConfig }
  | { type: 'onboarding:getProgress' }
  | { type: 'onboarding:set'; onboarded: boolean }
  | { type: 'capture:getPending' }
  | { type: 'capture:removePending'; id: string }
  | { type: 'capture:clearPending' }
  | { type: 'capture:currentSocial'; source: 'twitter' | 'weibo' }
  | { type: 'capture:currentArticle' }
  | { type: 'health:clearRecords' }
  | { type: 'health:retryOne'; bookmarkId: string }
  | { type: 'backups:list' };

export type ExtensionResponse =
  | { ok: true; data: ExtensionState }
  | { ok: true; data: StateSummary }
  | { ok: true; data: ClassificationPlan }
  | { ok: true; data: BackupRecord[] }
  | { ok: true; data: AppSettings }
  | { ok: true; data: AiProviderTestResult }
  | { ok: true; data: OnboardingProgressState }
  | { ok: true; data: { onboarded: boolean } }
  | { ok: true; data: CapturedContent[] }
  | { ok: true; data: { capture: CapturedContent } }
  | { ok: true; data: { removed: boolean } }
  | { ok: true; data: { cleared: boolean } }
  | { ok: true; data: { record: UrlHealthRecord; records: UrlHealthRecord[] } }
  | { ok: false; error: string; errorCode?: string };
