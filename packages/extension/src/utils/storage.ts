import type {
  AiProviderConfig,
  AiProviderType,
  AppSettings,
  BookmarkFolderResolutionRecord,
  BookmarkOperation,
  BookmarkOperationItem,
  BookmarkOperationJournalEnvelope,
  BookmarkOperationStorageErrorCode,
  CapturedContent,
  ClassificationMode,
  CustomRule,
  ExportManifest,
  MoveRecord,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import {
  BOOKMARK_OPERATION_JOURNAL_LIMIT,
  BOOKMARK_OPERATION_JOURNAL_MAX_BYTES,
  BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT,
  BOOKMARK_OPERATION_LIMITS,
  BOOKMARK_OPERATION_MAX_BYTES,
  BOOKMARK_OPERATION_RESERVE_BASE_BYTES,
  BOOKMARK_OPERATION_RESERVE_ITEM_BYTES,
  BOOKMARK_OPERATION_SCHEMA_VERSION,
  BookmarkOperationJournalEnvelopeSchema,
  BookmarkOperationSchema,
  PROVIDER_TEMPLATES,
  bookmarkOperationItemNeedsRestore,
  normalizeBookmarkTargetPath,
} from '../shared/bookmark-types.js';
import { UrlHealthRecordSchema } from '../shared/extension-messages.js';
import type { OnboardingProgress } from './onboarding.js';
import {
  DEFAULT_ACTIVE_PROVIDER_ID,
  createDefaultAiProviders,
  createProviderFromTemplate,
  providerTemplate,
  trimTrailingSlash,
} from '../shared/ai-providers.js';
import {
  DEFAULT_MARKDOWN_TEMPLATES,
  normalizeActiveTemplateIds,
  normalizeTemplates,
} from './markdown-templates.js';
import { normalizeCustomRule } from './rule-matcher.js';

export const SETTINGS_KEY = 'settings';
export const LAST_MOVE_RECORDS_KEY = 'lastMoveRecords';
export const EXPORT_MANIFESTS_KEY = 'exportManifests';
export const PENDING_CAPTURE_KEY = 'pendingCapture';
export const URL_HEALTH_RECORDS_KEY = 'urlHealthRecords';
export const ONBOARDED_KEY = 'onboarded';
export const ONBOARDING_PROGRESS_KEY = 'onboardingProgress';
export const BOOKMARK_OPERATIONS_KEY = 'bookmarkOperations';
export const BOOKMARK_OPERATION_RETENTION_COUNT = 20;
export const BOOKMARK_OPERATION_RETENTION_DAYS = 30;
export const TRUSTED_STORAGE_ACCESS_TIMEOUT_MS = 5_000;

export class BookmarkOperationStorageError extends Error {
  constructor(readonly code: BookmarkOperationStorageErrorCode) {
    super(code);
    this.name = 'BookmarkOperationStorageError';
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  useAi: false,
  activeProviderId: DEFAULT_ACTIVE_PROVIDER_ID,
  aiProviders: createDefaultAiProviders(),
  customRules: [],
  templates: DEFAULT_MARKDOWN_TEMPLATES,
  activeTemplateIds: {
    bookmark: 'default-bookmark',
    twitter: 'default-twitter',
    weibo: 'default-weibo',
    article: 'default-article',
  },
  defaultClassifyMode: 'safe',
  exportDirectory: 'Bookmarks',
};

function getLastError(): Error | undefined {
  const lastError = chrome.runtime.lastError;
  return lastError === undefined
    ? undefined
    : new Error(lastError.message || 'chrome_runtime_error');
}

let trustedLocalStorageAccess: Promise<void> | undefined;

function initializeTrustedLocalStorageAccess(): Promise<void> {
  return new Promise((resolve, reject) => {
    const storageArea = chrome.storage?.local;
    const setAccessLevel = storageArea?.setAccessLevel;
    if (typeof setAccessLevel !== 'function') {
      reject(new Error('trusted_storage_access_unavailable'));
      return;
    }

    let settled = false;
    const finish = (succeeded: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      if (!succeeded) {
        reject(new Error('trusted_storage_access_unavailable'));
        return;
      }
      resolve();
    };
    const timer = globalThis.setTimeout(() => finish(false), TRUSTED_STORAGE_ACCESS_TIMEOUT_MS);

    try {
      const result = setAccessLevel.call(storageArea, { accessLevel: 'TRUSTED_CONTEXTS' }, () =>
        finish(getLastError() === undefined),
      ) as unknown;
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof (result as PromiseLike<void>).then === 'function'
      ) {
        void Promise.resolve(result).then(
          () => finish(getLastError() === undefined),
          () => finish(false),
        );
      }
    } catch {
      finish(false);
    }
  });
}

export function ensureTrustedLocalStorageAccess(): Promise<void> {
  trustedLocalStorageAccess ??= initializeTrustedLocalStorageAccess();
  return trustedLocalStorageAccess;
}

export async function getLocalValue<T>(key: string, fallback: T): Promise<T> {
  await ensureTrustedLocalStorageAccess();
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve((items[key] as T | undefined) ?? fallback);
    });
  });
}

export async function setLocalValues(values: Record<string, unknown>): Promise<void> {
  await ensureTrustedLocalStorageAccess();
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function removeLocalValues(keys: string[]): Promise<void> {
  await ensureTrustedLocalStorageAccess();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeClassifyMode(value: unknown): ClassificationMode {
  return value === 'full' || value === 'safe' ? value : DEFAULT_SETTINGS.defaultClassifyMode;
}

function normalizeCustomRules(value: unknown): CustomRule[] {
  const rules = arrayOrEmpty<CustomRule>(value).filter(
    (rule) =>
      (rule.type === 'domain' ||
        rule.type === 'title-keyword' ||
        rule.type === 'url-pattern' ||
        rule.type === 'combined') &&
      typeof rule.pattern === 'string' &&
      typeof rule.category === 'string' &&
      Array.isArray(rule.tags),
  );

  return rules.map((rule, index) => normalizeCustomRule(rule, index, rules.length));
}

function normalizeProvider(value: unknown): AiProviderConfig | undefined {
  const provider = objectRecord(value);
  const providerType = provider.provider;
  const isKnownType = PROVIDER_TEMPLATES.some((template) => template.provider === providerType);

  if (!isKnownType) {
    return undefined;
  }

  const template = providerTemplate(providerType as AiProviderType);
  const id = typeof provider.id === 'string' && provider.id.trim() ? provider.id.trim() : undefined;
  const name =
    typeof provider.name === 'string' && provider.name.trim()
      ? provider.name.trim()
      : template.name;
  const baseUrl =
    typeof provider.baseUrl === 'string'
      ? trimTrailingSlash(provider.baseUrl.trim())
      : template.baseUrl;
  const model =
    typeof provider.model === 'string' && provider.model.trim()
      ? provider.model.trim()
      : template.defaultModel;
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
  const temperature =
    typeof provider.temperature === 'number' && Number.isFinite(provider.temperature)
      ? provider.temperature
      : 0.1;
  const maxTokens =
    typeof provider.maxTokens === 'number' && Number.isFinite(provider.maxTokens)
      ? provider.maxTokens
      : undefined;

  return createProviderFromTemplate(template, {
    id,
    name,
    enabled: provider.enabled !== false,
    apiKey,
    baseUrl,
    model,
    temperature,
    maxTokens,
  });
}

function providersWithDefaults(providers: AiProviderConfig[]): AiProviderConfig[] {
  const existing = new Map(providers.map((provider) => [provider.provider, provider]));
  const defaults = createDefaultAiProviders().map(
    (provider) => existing.get(provider.provider) ?? provider,
  );
  const defaultIds = new Set(defaults.map((provider) => provider.id));
  const customProviders = providers.filter((provider) => !defaultIds.has(provider.id));

  return [...defaults, ...customProviders];
}

export function normalizeSettings(value: unknown): AppSettings {
  const settings = objectRecord(value);
  const legacyApiKey = typeof settings.deepSeekApiKey === 'string' ? settings.deepSeekApiKey : '';
  const legacyModel =
    settings.deepSeekModel === 'deepseek-chat' || settings.deepSeekModel === 'deepseek-reasoner'
      ? settings.deepSeekModel
      : 'deepseek-chat';
  const hasProviderList = Array.isArray(settings.aiProviders);
  const normalizedProviders = hasProviderList
    ? providersWithDefaults(
        arrayOrEmpty<unknown>(settings.aiProviders)
          .map(normalizeProvider)
          .filter((provider): provider is AiProviderConfig => Boolean(provider)),
      )
    : providersWithDefaults(
        legacyApiKey
          ? [
              createProviderFromTemplate(providerTemplate('deepseek'), {
                id: 'deepseek-migrated',
                apiKey: legacyApiKey,
                model: legacyModel,
              }),
            ]
          : [],
      );
  const activeProviderId =
    typeof settings.activeProviderId === 'string' &&
    normalizedProviders.some((provider) => provider.id === settings.activeProviderId)
      ? settings.activeProviderId
      : legacyApiKey
        ? 'deepseek-migrated'
        : DEFAULT_SETTINGS.activeProviderId;
  const exportDirectory =
    typeof settings.exportDirectory === 'string' && settings.exportDirectory.trim()
      ? settings.exportDirectory
      : DEFAULT_SETTINGS.exportDirectory;

  return {
    useAi: settings.useAi === true || Boolean(legacyApiKey),
    activeProviderId,
    aiProviders: normalizedProviders,
    customRules: normalizeCustomRules(settings.customRules),
    templates: normalizeTemplates(settings.templates),
    activeTemplateIds: normalizeActiveTemplateIds(settings.activeTemplateIds),
    defaultClassifyMode: normalizeClassifyMode(settings.defaultClassifyMode),
    exportDirectory,
  };
}

export async function getSettings(): Promise<AppSettings> {
  return normalizeSettings(await getLocalValue<unknown>(SETTINGS_KEY, {}));
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return setLocalValues({ [SETTINGS_KEY]: settings });
}

export function getLastMoveRecords(): Promise<MoveRecord[]> {
  return getLocalValue<MoveRecord[]>(LAST_MOVE_RECORDS_KEY, []);
}

export function saveLastMoveRecords(records: MoveRecord[]): Promise<void> {
  return setLocalValues({ [LAST_MOVE_RECORDS_KEY]: records });
}

export function getExportManifests(): Promise<ExportManifest[]> {
  return getLocalValue<ExportManifest[]>(EXPORT_MANIFESTS_KEY, []);
}

export async function saveExportManifest(manifest: ExportManifest): Promise<void> {
  const manifests = await getExportManifests();
  await setLocalValues({
    [EXPORT_MANIFESTS_KEY]: [manifest, ...manifests].slice(0, 10),
  });
}

export function getPendingCapture(): Promise<CapturedContent | undefined> {
  return getLocalValue<CapturedContent | undefined>(PENDING_CAPTURE_KEY, undefined);
}

export async function getPendingCaptures(): Promise<CapturedContent[]> {
  const value = await getLocalValue<CapturedContent[] | CapturedContent | undefined>(
    PENDING_CAPTURE_KEY,
    undefined,
  );

  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

export async function savePendingCapture(capture: CapturedContent): Promise<void> {
  const captures = await getPendingCaptures();
  const withoutDuplicate = captures.filter((item) => item.id !== capture.id);

  return setLocalValues({ [PENDING_CAPTURE_KEY]: [capture, ...withoutDuplicate].slice(0, 20) });
}

export async function removePendingCapture(id: string): Promise<boolean> {
  const captures = await getPendingCaptures();
  const nextCaptures = captures.filter((capture) => capture.id !== id);
  await setLocalValues({ [PENDING_CAPTURE_KEY]: nextCaptures });

  return nextCaptures.length !== captures.length;
}

export function clearPendingCapture(): Promise<void> {
  return removeLocalValues([PENDING_CAPTURE_KEY]);
}

export async function getUrlHealthRecords(): Promise<UrlHealthRecord[]> {
  const stored = await getLocalValue<unknown>(URL_HEALTH_RECORDS_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }

  const records: UrlHealthRecord[] = [];
  for (const candidate of stored.slice(0, 10_000)) {
    const parsed = UrlHealthRecordSchema.safeParse(candidate);
    if (parsed.success) {
      records.push(parsed.data);
    }
  }
  return records;
}

export function saveUrlHealthRecords(records: UrlHealthRecord[]): Promise<void> {
  return setLocalValues({ [URL_HEALTH_RECORDS_KEY]: records });
}

export function clearUrlHealthRecords(): Promise<void> {
  return removeLocalValues([URL_HEALTH_RECORDS_KEY]);
}

export function pruneBookmarkOperations(
  operations: readonly BookmarkOperation[],
  now = Date.now(),
): BookmarkOperation[] {
  const cutoff = now - BOOKMARK_OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  const protectedStatuses = new Set<BookmarkOperation['status']>([
    'prepared',
    'running',
    'partial',
    'restoring',
    'restore_partial',
  ]);
  const sorted = [...operations].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const retained = sorted.filter(
    (operation, index) =>
      protectedStatuses.has(operation.status) ||
      index < BOOKMARK_OPERATION_RETENTION_COUNT ||
      Date.parse(operation.updatedAt) >= cutoff,
  );
  if (retained.length > BOOKMARK_OPERATION_JOURNAL_LIMIT) {
    throw new BookmarkOperationStorageError('journal_capacity_exceeded');
  }
  return retained;
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new BookmarkOperationStorageError('journal_corrupt');
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function assertOperationSize(operation: BookmarkOperation, reserveBytes = 0): void {
  const operationBytes = jsonByteLength(operation);
  if (operationBytes > BOOKMARK_OPERATION_MAX_BYTES) {
    throw new BookmarkOperationStorageError('operation_too_large');
  }
  if (operationBytes + reserveBytes > BOOKMARK_OPERATION_MAX_BYTES) {
    throw new BookmarkOperationStorageError('journal_reserve_exceeded');
  }
}

function validatedOperation(value: unknown): BookmarkOperation {
  const parsed = BookmarkOperationSchema.safeParse(value);
  if (!parsed.success) {
    throw bookmarkOperationSchemaError(parsed.error);
  }
  return parsed.data;
}

function bookmarkOperationSchemaError(error: {
  issues: readonly { message: string }[];
}): BookmarkOperationStorageError {
  const messages = new Set(error.issues.map((issue) => issue.message));
  if (messages.has('journal_too_large')) {
    return new BookmarkOperationStorageError('journal_too_large');
  }
  if (messages.has('operation_too_large')) {
    return new BookmarkOperationStorageError('operation_too_large');
  }
  return new BookmarkOperationStorageError('journal_corrupt');
}

function requiredOperationReserve(operation: BookmarkOperation): number {
  if (!operationNeedsReservation(operation)) {
    return 0;
  }

  const operationBytes = jsonByteLength(operation);
  const remainingCapacity = BOOKMARK_OPERATION_MAX_BYTES - operationBytes;
  const minimumFutureGrowth = minimumOperationFutureGrowth(operation);
  if (remainingCapacity < minimumFutureGrowth) {
    throw new BookmarkOperationStorageError('journal_reserve_exceeded');
  }
  return remainingCapacity;
}

const BOOKMARK_OPERATION_COMMAND_OUTCOME_RESERVE_BYTES = 1_024;
const BOOKMARK_OPERATION_ACTIVE_METADATA_RESERVE_BYTES = 2_048;
const MAX_BOOKMARK_ID_A = 'a'.repeat(BOOKMARK_OPERATION_LIMITS.bookmarkId);
const MAX_BOOKMARK_ID_B = 'b'.repeat(BOOKMARK_OPERATION_LIMITS.bookmarkId);
const MAX_FOLDER_TIMESTAMP = '9999-12-31T23:59:59.999Z';

function pendingCommand(
  operation: BookmarkOperation,
  action: BookmarkOperation['commands'][number]['action'],
): boolean {
  return operation.commands.some(
    (command) => command.action === action && command.status === 'pending',
  );
}

function operationNeedsReservation(operation: BookmarkOperation): boolean {
  return (
    operation.status === 'prepared' ||
    operation.status === 'running' ||
    operation.status === 'restoring' ||
    operation.commands.some((command) => command.status === 'pending')
  );
}

function operationIsRestoring(operation: BookmarkOperation): boolean {
  return operation.status === 'restoring' || pendingCommand(operation, 'restore');
}

function maximumFolderRecordBytes(path: string, title: string): number {
  const common = {
    path,
    title,
    parentId: MAX_BOOKMARK_ID_A,
    attemptCount: BOOKMARK_OPERATION_LIMITS.attemptCount,
  };
  const candidates: BookmarkFolderResolutionRecord[] = [
    {
      ...common,
      baselineIds: [MAX_BOOKMARK_ID_B],
      status: 'existing',
      folderId: MAX_BOOKMARK_ID_B,
      attemptCount: 0,
    },
    {
      ...common,
      baselineIds: [],
      status: 'attempted',
      attemptedAt: MAX_FOLDER_TIMESTAMP,
    },
    {
      ...common,
      baselineIds: [],
      status: 'created',
      folderId: MAX_BOOKMARK_ID_B,
      callbackId: MAX_BOOKMARK_ID_B,
      attemptedAt: MAX_FOLDER_TIMESTAMP,
    },
    {
      ...common,
      baselineIds: [],
      status: 'reconciled',
      folderId: MAX_BOOKMARK_ID_B,
      attemptedAt: MAX_FOLDER_TIMESTAMP,
    },
    {
      ...common,
      baselineIds: Array.from(
        { length: BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT },
        (_, index) =>
          `${index === 0 ? 'a' : 'b'}${'c'.repeat(BOOKMARK_OPERATION_LIMITS.bookmarkId - 1)}`,
      ),
      status: 'conflict',
      errorCode: 'target_folder_conflict',
      attemptCount: 0,
    },
    {
      ...common,
      baselineIds: [],
      status: 'failed',
      attemptedAt: MAX_FOLDER_TIMESTAMP,
      errorCode: 'target_folder_error',
    },
  ];
  return Math.max(...candidates.map((candidate) => jsonByteLength(candidate)));
}

function remainingFolderResolutionGrowth(operation: BookmarkOperation): number {
  if (operationIsRestoring(operation)) {
    return 0;
  }

  let reserve = 0;
  for (const item of operation.items) {
    if (
      item.kind !== 'move' ||
      item.executionStatus !== 'pending' ||
      item.targetStatus === 'resolved' ||
      item.targetStatus === 'failed' ||
      item.targetStatus === 'conflict'
    ) {
      continue;
    }

    const recordsByPath = new Map(item.folderResolution.map((record) => [record.path, record]));
    const segments = normalizeBookmarkTargetPath(item.targetFolder).split('/');
    let path = '';
    for (const title of segments) {
      path = path ? `${path}/${title}` : title;
      const existing = recordsByPath.get(path);
      const maximumBytes = maximumFolderRecordBytes(path, title);
      if (!existing) {
        reserve += maximumBytes + 1;
        continue;
      }
      if (existing.status === 'attempted') {
        reserve += Math.max(0, maximumBytes - jsonByteLength(existing));
        continue;
      }
      if (existing.status === 'failed' || existing.status === 'conflict') {
        break;
      }
    }
  }
  return reserve;
}

function remainingRecoveryFolderGrowth(operation: BookmarkOperation): number {
  if (
    !operationIsRestoring(operation) ||
    operation.type !== 'delete_bookmarks' ||
    operation.recoveryFolder?.status === 'existing' ||
    operation.recoveryFolder?.status === 'created' ||
    operation.recoveryFolder?.status === 'reconciled' ||
    operation.recoveryFolder?.status === 'failed' ||
    operation.recoveryFolder?.status === 'conflict'
  ) {
    return 0;
  }

  const maximumBytes = maximumFolderRecordBytes('ShuHai Recovery', 'ShuHai Recovery');
  if (!operation.recoveryFolder) {
    return maximumBytes;
  }
  return Math.max(0, maximumBytes - jsonByteLength(operation.recoveryFolder));
}

function minimumOperationFutureGrowth(operation: BookmarkOperation): number {
  const restoring = operationIsRestoring(operation);
  const acceptingCurrent = pendingCommand(operation, 'accept_current');
  const pendingItemCount = restoring
    ? operation.items.filter(bookmarkOperationItemNeedsRestore).length +
      operation.items.filter((item) => item.kind === 'move' && item.restoreStatus === 'restored')
        .length
    : acceptingCurrent
      ? operation.items.filter(
          (item) =>
            item.executionStatus === 'succeeded' &&
            (item.restoreStatus === 'conflict' || item.restoreStatus === 'restore_failed'),
        ).length
      : operation.items.filter((item) => item.executionStatus === 'pending').length;
  const pendingCommandCount = operation.commands.filter(
    (command) => command.status === 'pending',
  ).length;
  const baseReserve =
    operation.status === 'prepared'
      ? BOOKMARK_OPERATION_RESERVE_BASE_BYTES
      : BOOKMARK_OPERATION_ACTIVE_METADATA_RESERVE_BYTES;

  return (
    baseReserve +
    pendingItemCount * BOOKMARK_OPERATION_RESERVE_ITEM_BYTES +
    pendingCommandCount * BOOKMARK_OPERATION_COMMAND_OUTCOME_RESERVE_BYTES +
    remainingFolderResolutionGrowth(operation) +
    remainingRecoveryFolderGrowth(operation)
  );
}

function remainingFolderResolutionWrites(operation: BookmarkOperation): number {
  if (operationIsRestoring(operation)) {
    return 0;
  }

  let writes = 0;
  for (const item of operation.items) {
    if (item.kind !== 'move' || item.executionStatus !== 'pending') {
      continue;
    }
    if (item.targetStatus === 'failed' || item.targetStatus === 'conflict') {
      writes += 1;
      continue;
    }

    if (item.targetStatus === 'pending') {
      writes += 1;
    }
    if (item.targetStatus !== 'resolved') {
      const recordsByPath = new Map(item.folderResolution.map((record) => [record.path, record]));
      const segments = normalizeBookmarkTargetPath(item.targetFolder).split('/');
      let path = '';
      let stopped = false;
      for (const title of segments) {
        path = path ? `${path}/${title}` : title;
        const existing = recordsByPath.get(path);
        if (!existing) {
          writes += 2;
        } else if (existing.status === 'attempted') {
          writes += 1;
        } else if (existing.status === 'failed' || existing.status === 'conflict') {
          stopped = true;
          break;
        }
      }
      if (stopped) {
        writes += 1;
        continue;
      }
      writes += 1;
    }
    writes += item.executionAttemptCount === 0 ? 2 : 1;
  }
  return writes;
}

function remainingRecoveryFolderWrites(operation: BookmarkOperation): number {
  if (
    !operationIsRestoring(operation) ||
    operation.type !== 'delete_bookmarks' ||
    operation.recoveryFolder?.status === 'existing' ||
    operation.recoveryFolder?.status === 'created' ||
    operation.recoveryFolder?.status === 'reconciled' ||
    operation.recoveryFolder?.status === 'failed' ||
    operation.recoveryFolder?.status === 'conflict'
  ) {
    return 0;
  }
  return operation.recoveryFolder?.status === 'attempted' ? 1 : 2;
}

function remainingRestoreAttemptWrites(item: BookmarkOperationItem): number {
  const remainingAttempts = Math.max(
    0,
    BOOKMARK_OPERATION_LIMITS.attemptCount - item.restoreAttemptCount,
  );
  if (item.restoreStatus === 'pending' && item.restoreAttemptCount > 0) {
    return 1 + remainingAttempts * 2;
  }
  return remainingAttempts * 2;
}

function remainingMoveVerificationWrites(item: BookmarkOperationItem): number {
  if (item.kind !== 'move') {
    return 0;
  }
  const remainingAttempts = Math.max(
    0,
    BOOKMARK_OPERATION_LIMITS.attemptCount - item.restoreAttemptCount,
  );
  return (
    remainingAttempts + (item.restoreStatus === 'pending' && item.restoreAttemptCount > 0 ? 1 : 0)
  );
}

function requiredOperationFutureWrites(operation: BookmarkOperation): number {
  if (!operationNeedsReservation(operation)) {
    return 0;
  }

  let writes = 1;
  if (operation.status === 'prepared') {
    writes += 1;
  }
  if (operationIsRestoring(operation)) {
    for (const item of operation.items) {
      if (!bookmarkOperationItemNeedsRestore(item)) {
        continue;
      }
      writes += remainingRestoreAttemptWrites(item);
      writes += remainingMoveVerificationWrites(item);
    }
    for (const item of operation.items) {
      if (item.kind === 'move' && item.restoreStatus === 'restored') {
        writes +=
          1 + Math.max(0, BOOKMARK_OPERATION_LIMITS.attemptCount - item.restoreAttemptCount) * 3;
      }
    }
    return writes + remainingRecoveryFolderWrites(operation);
  }
  if (pendingCommand(operation, 'accept_current')) {
    return writes;
  }

  for (const item of operation.items) {
    if (item.kind !== 'move' && item.executionStatus === 'pending') {
      writes += item.executionAttemptCount === 0 ? 2 : 1;
    }
  }
  return writes + remainingFolderResolutionWrites(operation);
}

export function getBookmarkOperationReserveBytes(operation: BookmarkOperation): number {
  const validated = validatedOperation(operation);
  return requiredOperationReserve(validated);
}

function assertEnvelopeSize(envelope: BookmarkOperationJournalEnvelope): void {
  let totalReserveBytes = 0;
  let totalFutureWrites = 0;
  for (const operation of envelope.operations) {
    const operationReserve = requiredOperationReserve(operation);
    assertOperationSize(operation, operationReserve);
    totalReserveBytes += operationReserve;
    totalFutureWrites += requiredOperationFutureWrites(operation);
  }
  const envelopeBytes = jsonByteLength(envelope);
  const revisionReserveBytes =
    totalFutureWrites > 0
      ? String(Number.MAX_SAFE_INTEGER).length - String(envelope.revision).length
      : 0;
  if (envelope.revision > Number.MAX_SAFE_INTEGER - totalFutureWrites) {
    throw new BookmarkOperationStorageError('journal_reserve_exceeded');
  }
  if (envelopeBytes > BOOKMARK_OPERATION_JOURNAL_MAX_BYTES) {
    throw new BookmarkOperationStorageError('journal_too_large');
  }
  if (
    envelopeBytes + totalReserveBytes + revisionReserveBytes >
    BOOKMARK_OPERATION_JOURNAL_MAX_BYTES
  ) {
    throw new BookmarkOperationStorageError('journal_reserve_exceeded');
  }
}

async function getRawBookmarkOperationJournal(): Promise<{
  present: boolean;
  value?: unknown;
}> {
  try {
    await ensureTrustedLocalStorageAccess();
  } catch {
    throw new BookmarkOperationStorageError('storage_read_failed');
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(BOOKMARK_OPERATIONS_KEY, (items) => {
        const error = getLastError();
        if (error) {
          reject(new BookmarkOperationStorageError('storage_read_failed'));
          return;
        }

        if (!items || typeof items !== 'object') {
          reject(new BookmarkOperationStorageError('storage_read_failed'));
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(items, BOOKMARK_OPERATIONS_KEY)) {
          resolve({ present: false });
          return;
        }
        resolve({ present: true, value: items[BOOKMARK_OPERATIONS_KEY] });
      });
    } catch {
      reject(new BookmarkOperationStorageError('storage_read_failed'));
    }
  });
}

async function setRawBookmarkOperationJournal(
  envelope: BookmarkOperationJournalEnvelope,
): Promise<void> {
  try {
    await ensureTrustedLocalStorageAccess();
  } catch {
    throw new BookmarkOperationStorageError('storage_write_failed');
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [BOOKMARK_OPERATIONS_KEY]: envelope }, () => {
        const error = getLastError();
        if (error) {
          reject(new BookmarkOperationStorageError('storage_write_failed'));
          return;
        }
        resolve();
      });
    } catch {
      reject(new BookmarkOperationStorageError('storage_write_failed'));
    }
  });
}

export async function getBookmarkOperationJournal(): Promise<BookmarkOperationJournalEnvelope> {
  const stored = await getRawBookmarkOperationJournal();
  if (!stored.present) {
    return {
      version: BOOKMARK_OPERATION_SCHEMA_VERSION,
      revision: 0,
      operations: [],
    };
  }

  const parsed = BookmarkOperationJournalEnvelopeSchema.safeParse(stored.value);
  if (!parsed.success) {
    throw bookmarkOperationSchemaError(parsed.error);
  }
  assertEnvelopeSize(parsed.data);
  return cloneValue(parsed.data);
}

export async function getBookmarkOperations(): Promise<BookmarkOperation[]> {
  const envelope = await getBookmarkOperationJournal();
  return envelope.operations.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

let bookmarkJournalWriteTail: Promise<void> = Promise.resolve();

function withBookmarkJournalWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = bookmarkJournalWriteTail.then(write, write);
  bookmarkJournalWriteTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function assertRevision(current: BookmarkOperationJournalEnvelope, expectedRevision: number): void {
  if (current.revision !== expectedRevision) {
    throw new BookmarkOperationStorageError('journal_revision_conflict');
  }
}

function immutableOperationFingerprint(operation: BookmarkOperation): string {
  return JSON.stringify({
    id: operation.id,
    requestId: operation.requestId,
    payloadIdentity: operation.payloadIdentity,
    version: operation.version,
    type: operation.type,
    source: operation.source,
    createdAt: operation.createdAt,
    requestedCount: operation.requestedCount,
    items: operation.items.map((item) => ({
      kind: item.kind,
      bookmarkId: item.bookmarkId,
      title: item.title,
      original: item.original,
      ...(item.kind === 'delete'
        ? { restoreBaselineBookmarkIds: item.restoreBaselineBookmarkIds }
        : item.kind === 'update_url'
          ? { oldUrl: item.oldUrl, newUrl: item.newUrl }
          : {
              targetFolder: item.targetFolder,
              requestedTargetIndex: item.requestedTargetIndex,
            }),
    })),
  });
}

function assertOperationEvolution(previous: BookmarkOperation, next: BookmarkOperation): void {
  if (immutableOperationFingerprint(previous) !== immutableOperationFingerprint(next)) {
    throw new BookmarkOperationStorageError('journal_corrupt');
  }

  const nextByRequestId = new Map(next.commands.map((command) => [command.requestId, command]));
  for (const previousCommand of previous.commands) {
    const nextCommand = nextByRequestId.get(previousCommand.requestId);
    if (
      !nextCommand ||
      nextCommand.action !== previousCommand.action ||
      nextCommand.payloadIdentity !== previousCommand.payloadIdentity ||
      nextCommand.createdAt !== previousCommand.createdAt ||
      (previousCommand.status !== 'pending' &&
        JSON.stringify(previousCommand) !== JSON.stringify(nextCommand))
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
  }

  const previousFolderRecords = [
    ...previous.items.flatMap((item) => (item.kind === 'move' ? item.folderResolution : [])),
    ...(previous.recoveryFolder ? [previous.recoveryFolder] : []),
  ];
  const nextFolderRecords = [
    ...next.items.flatMap((item) => (item.kind === 'move' ? item.folderResolution : [])),
    ...(next.recoveryFolder ? [next.recoveryFolder] : []),
  ];
  for (const previousRecord of previousFolderRecords) {
    const nextRecord = nextFolderRecords.find(
      (record) =>
        record.path === previousRecord.path &&
        record.parentId === previousRecord.parentId &&
        record.title === previousRecord.title,
    );
    if (
      !nextRecord ||
      JSON.stringify(previousRecord.baselineIds) !== JSON.stringify(nextRecord.baselineIds)
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    if (
      previousRecord.status !== 'attempted' &&
      JSON.stringify(previousRecord) !== JSON.stringify(nextRecord)
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
  }

  previous.items.forEach((previousItem, index) => {
    const nextItem = next.items[index];
    if (!nextItem || nextItem.kind !== previousItem.kind) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    const finalMoveVerificationDowngrade =
      previousItem.kind === 'move' &&
      nextItem.kind === 'move' &&
      previousItem.restoreStatus === 'restored' &&
      nextItem.restoreStatus === 'conflict' &&
      nextItem.restoreErrorCode === 'restore_conflict' &&
      nextItem.restoreAttemptCount === previousItem.restoreAttemptCount &&
      nextItem.restoreAttemptedAt === previousItem.restoreAttemptedAt &&
      previous.commands.some(
        (command) => command.action === 'restore' && command.status === 'pending',
      );
    if (
      nextItem.executionAttemptCount < previousItem.executionAttemptCount ||
      (nextItem.executionAttemptCount === previousItem.executionAttemptCount &&
        previousItem.executionAttemptedAt !== undefined &&
        nextItem.executionAttemptedAt !== previousItem.executionAttemptedAt) ||
      (previousItem.executionStatus !== 'pending' &&
        (nextItem.executionStatus !== previousItem.executionStatus ||
          nextItem.executionCompletedAt !== previousItem.executionCompletedAt ||
          nextItem.errorCode !== previousItem.errorCode))
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    if (
      nextItem.restoreAttemptCount < previousItem.restoreAttemptCount ||
      (nextItem.restoreAttemptCount === previousItem.restoreAttemptCount &&
        previousItem.restoreAttemptedAt !== undefined &&
        nextItem.restoreAttemptedAt !== previousItem.restoreAttemptedAt) ||
      ((previousItem.restoreStatus === 'restored' ||
        previousItem.restoreStatus === 'accepted_current') &&
        (nextItem.restoreStatus !== previousItem.restoreStatus ||
          nextItem.restoreCompletedAt !== previousItem.restoreCompletedAt) &&
        !finalMoveVerificationDowngrade)
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    if (
      previousItem.kind === 'move' &&
      nextItem.kind === 'move' &&
      ((previousItem.targetParentId !== undefined &&
        nextItem.targetParentId !== previousItem.targetParentId) ||
        (previousItem.actualTargetIndex !== undefined &&
          nextItem.actualTargetIndex !== previousItem.actualTargetIndex))
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    if (
      previousItem.kind === 'delete' &&
      nextItem.kind === 'delete' &&
      ((previousItem.restoreTargetParentId !== undefined &&
        nextItem.restoreTargetParentId !== previousItem.restoreTargetParentId) ||
        (previousItem.restoredBookmarkId !== undefined &&
          nextItem.restoredBookmarkId !== previousItem.restoredBookmarkId) ||
        (previousItem.restoredParentId !== undefined &&
          nextItem.restoredParentId !== previousItem.restoredParentId))
    ) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
  });
  if (
    previous.recoveryFolder &&
    previous.recoveryFolder.status !== 'attempted' &&
    JSON.stringify(previous.recoveryFolder) !== JSON.stringify(next.recoveryFolder)
  ) {
    throw new BookmarkOperationStorageError('journal_corrupt');
  }
}

function validateNextEnvelope(
  current: BookmarkOperationJournalEnvelope,
  operations: readonly BookmarkOperation[],
): BookmarkOperationJournalEnvelope {
  const next: BookmarkOperationJournalEnvelope = {
    version: BOOKMARK_OPERATION_SCHEMA_VERSION,
    revision: current.revision + 1,
    operations: pruneBookmarkOperations(operations),
  };
  const parsed = BookmarkOperationJournalEnvelopeSchema.safeParse(next);
  if (!parsed.success) {
    throw bookmarkOperationSchemaError(parsed.error);
  }
  assertEnvelopeSize(parsed.data);
  return parsed.data;
}

export function saveBookmarkOperationJournal(
  envelope: BookmarkOperationJournalEnvelope,
  expectedRevision: number,
): Promise<BookmarkOperationJournalEnvelope> {
  return withBookmarkJournalWrite(async () => {
    const current = await getBookmarkOperationJournal();
    assertRevision(current, expectedRevision);
    const requested = BookmarkOperationJournalEnvelopeSchema.safeParse(envelope);
    if (!requested.success) {
      throw bookmarkOperationSchemaError(requested.error);
    }
    if (requested.data.revision !== expectedRevision) {
      throw new BookmarkOperationStorageError('journal_revision_conflict');
    }
    if (requested.data.operations.length !== current.operations.length) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    for (const currentOperation of current.operations) {
      const nextOperation = requested.data.operations.find(
        (operation) => operation.id === currentOperation.id,
      );
      if (!nextOperation) {
        throw new BookmarkOperationStorageError('journal_corrupt');
      }
      assertOperationEvolution(currentOperation, nextOperation);
    }
    const next = validateNextEnvelope(current, requested.data.operations);
    await setRawBookmarkOperationJournal(next);
    return cloneValue(next);
  });
}

export interface BookmarkOperationWriteResult {
  envelope: BookmarkOperationJournalEnvelope;
  operation: BookmarkOperation;
}

export function insertBookmarkOperation(
  operation: BookmarkOperation,
  reserveBytes: number,
): Promise<BookmarkOperationWriteResult> {
  return withBookmarkJournalWrite(async () => {
    const current = await getBookmarkOperationJournal();
    const validated = validatedOperation(operation);
    const requiredReserve = requiredOperationReserve(validated);
    if (reserveBytes < requiredReserve) {
      throw new BookmarkOperationStorageError('journal_reserve_exceeded');
    }
    assertOperationSize(validated, reserveBytes);
    if (current.operations.some((item) => item.id === validated.id)) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    const existingRequestIds = new Set(
      current.operations.flatMap((item) => item.commands.map((command) => command.requestId)),
    );
    if (validated.commands.some((command) => existingRequestIds.has(command.requestId))) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    const operations = [validated, ...current.operations];
    const next = validateNextEnvelope(current, operations);
    if (!next.operations.some((item) => item.id === validated.id)) {
      throw new BookmarkOperationStorageError('journal_capacity_exceeded');
    }
    await setRawBookmarkOperationJournal(next);
    return {
      envelope: cloneValue(next),
      operation: cloneValue(validated),
    };
  });
}

export function saveBookmarkOperation(
  operation: BookmarkOperation,
  expectedRevision: number,
): Promise<BookmarkOperationWriteResult> {
  return withBookmarkJournalWrite(async () => {
    const current = await getBookmarkOperationJournal();
    assertRevision(current, expectedRevision);
    const validated = validatedOperation(operation);
    const previous = current.operations.find((item) => item.id === validated.id);
    if (!previous) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    assertOperationEvolution(previous, validated);
    const next = validateNextEnvelope(current, [
      validated,
      ...current.operations.filter((item) => item.id !== validated.id),
    ]);
    await setRawBookmarkOperationJournal(next);
    return {
      envelope: cloneValue(next),
      operation: cloneValue(validated),
    };
  });
}

export function updateBookmarkOperation(
  operationId: string,
  update: (operation: BookmarkOperation) => BookmarkOperation | void,
): Promise<BookmarkOperationWriteResult> {
  return withBookmarkJournalWrite(async () => {
    const current = await getBookmarkOperationJournal();
    const previous = current.operations.find((operation) => operation.id === operationId);
    if (!previous) {
      throw new BookmarkOperationStorageError('journal_corrupt');
    }
    const draft = cloneValue(previous);
    const candidate = update(draft) ?? draft;
    const validated = validatedOperation(candidate);
    assertOperationEvolution(previous, validated);
    const next = validateNextEnvelope(current, [
      validated,
      ...current.operations.filter((operation) => operation.id !== operationId),
    ]);
    await setRawBookmarkOperationJournal(next);
    return {
      envelope: cloneValue(next),
      operation: cloneValue(validated),
    };
  });
}

export async function getBookmarkOperation(id: string): Promise<BookmarkOperation | undefined> {
  const operations = await getBookmarkOperations();
  return operations.find((operation) => operation.id === id);
}

export async function getBookmarkOperationByRequestId(
  requestId: string,
): Promise<BookmarkOperation | undefined> {
  const operations = await getBookmarkOperations();
  return operations.find((operation) =>
    operation.commands.some((command) => command.requestId === requestId),
  );
}

export function getOnboarded(): Promise<boolean> {
  return getLocalValue<boolean>(ONBOARDED_KEY, false);
}

export function saveOnboarded(onboarded: boolean): Promise<void> {
  return setLocalValues({ [ONBOARDED_KEY]: onboarded });
}

export function getOnboardingProgress(): Promise<OnboardingProgress | undefined> {
  return getLocalValue<OnboardingProgress | undefined>(ONBOARDING_PROGRESS_KEY, undefined);
}

export function saveOnboardingProgress(progress: OnboardingProgress): Promise<void> {
  return setLocalValues({ [ONBOARDING_PROGRESS_KEY]: progress });
}
