import type {
  AiProviderConfig,
  AiProviderSecret,
  AiProviderSecretsEnvelope,
  AiProviderType,
  AppSettings,
  BookmarkFolderResolutionRecord,
  BookmarkOperation,
  BookmarkOperationItem,
  BookmarkOperationJournalEnvelope,
  BookmarkOperationStorageErrorCode,
  BookmarkTaskSettings,
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
  bookmarkOperationItemNeedsRestore,
  normalizeBookmarkTargetPath,
} from '../shared/bookmark-types.js';
import {
  UrlHealthRecordSchema,
  cloneBoundedStructuredValue,
} from '../shared/extension-messages.js';
import type { StructuredInputLimits } from '../shared/extension-messages.js';
import type { OnboardingProgress } from './onboarding.js';
import type { LegacyPendingSummary } from '../shared/extension-messages.js';
import {
  DEFAULT_ACTIVE_PROVIDER_ID,
  AI_PROVIDER_TYPES,
  createAiProviderSecret,
  createDefaultAiProviders,
  createProviderFromTemplate,
  emptyAiProviderSecrets,
  getAiProviderSecret,
  isAiProviderType,
  isValidAiModel,
  parseAiProviderSecrets,
  providerTemplate,
  removeAiProviderSecret,
  upsertAiProviderSecret,
} from '../shared/ai-providers.js';
import {
  DEFAULT_MARKDOWN_TEMPLATES,
  normalizeActiveTemplateIds,
  normalizeTemplates,
} from './markdown-templates.js';
import { normalizeCustomRule } from './rule-matcher.js';

export const SETTINGS_KEY = 'settings';
export const AI_PROVIDER_SECRETS_KEY = 'aiProviderSecrets';
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
export const AI_PUBLIC_SETTINGS_VERSION = 2 as const;
export const LEGACY_PENDING_MAX_BYTES = 512 * 1024;

const SETTINGS_INPUT_LIMITS = Object.freeze({
  maxBytes: 512 * 1_024,
  maxDepth: 32,
  maxNodes: 20_000,
  maxStringBytes: 256 * 1_024,
});

interface BookmarkTaskFieldLimits extends StructuredInputLimits {
  readonly maxArrayLength?: number;
}

const BOOKMARK_TASK_FIELD_LIMITS: Readonly<
  Record<keyof BookmarkTaskSettings, BookmarkTaskFieldLimits>
> = Object.freeze({
  useAi: Object.freeze({
    maxBytes: 16,
    maxDepth: 1,
    maxNodes: 2,
    maxStringBytes: 8,
  }),
  activeProviderId: Object.freeze({
    maxBytes: 256,
    maxDepth: 1,
    maxNodes: 2,
    maxStringBytes: 128,
  }),
  aiProviders: Object.freeze({
    maxBytes: 32 * 1_024,
    maxDepth: 6,
    maxNodes: 256,
    maxStringBytes: 4_096,
    maxArrayLength: AI_PROVIDER_TYPES.length,
  }),
  aiLegacySummary: Object.freeze({
    maxBytes: 4 * 1_024,
    maxDepth: 4,
    maxNodes: 32,
    maxStringBytes: 128,
  }),
  customRules: Object.freeze({
    maxBytes: 512 * 1_024,
    maxDepth: 8,
    maxNodes: 100_000,
    maxStringBytes: 4_096,
    maxArrayLength: 10_000,
  }),
  defaultClassifyMode: Object.freeze({
    maxBytes: 32,
    maxDepth: 1,
    maxNodes: 2,
    maxStringBytes: 16,
  }),
});

interface StoredPublicSettings {
  version: typeof AI_PUBLIC_SETTINGS_VERSION;
  settings: AppSettings;
}

interface LegacyAiInspection {
  settings: Record<string, unknown>;
  providers: AiProviderConfig[];
  secrets: AiProviderSecret[];
  activeProvider: AiProviderType;
  useAi: boolean;
  summary: AppSettings['aiLegacySummary'];
  conflict: boolean;
}

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
  aiLegacySummary: {
    builtInConflicts: [],
    customState: 'absent',
  },
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

export async function getLocalBytesInUse(key: string): Promise<number> {
  await ensureTrustedLocalStorageAccess();
  return new Promise((resolve, reject) => {
    chrome.storage.local.getBytesInUse(key, (bytesInUse) => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }
      resolve(bytesInUse);
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

function ownDataProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function bookmarkTaskSettingsSource(raw: unknown): unknown {
  return ownDataProperty(raw, 'version') === AI_PUBLIC_SETTINGS_VERSION
    ? ownDataProperty(raw, 'settings')
    : raw;
}

function readBookmarkTaskField<K extends keyof BookmarkTaskSettings>(
  source: unknown,
  key: K,
): unknown {
  const value = ownDataProperty(source, key);
  const limits = BOOKMARK_TASK_FIELD_LIMITS[key];
  if (
    limits.maxArrayLength !== undefined &&
    Array.isArray(value) &&
    value.length > limits.maxArrayLength
  ) {
    return undefined;
  }
  try {
    return cloneBoundedStructuredValue(value, limits);
  } catch {
    return undefined;
  }
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

function safeSettingsRecord(value: unknown): Record<string, unknown> {
  try {
    return objectRecord(cloneBoundedStructuredValue(value, SETTINGS_INPUT_LIMITS));
  } catch {
    return {};
  }
}

function normalizePublicProvider(value: unknown): AiProviderConfig | undefined {
  const provider = objectRecord(value);
  const providerType = provider.provider;
  if (!isAiProviderType(providerType)) {
    return undefined;
  }

  const template = providerTemplate(providerType);
  const model = isValidAiModel(provider.model) ? provider.model : template.defaultModel;

  return createProviderFromTemplate(template, {
    enabled: provider.enabled !== false,
    model,
    hasApiKey: provider.hasApiKey === true,
  });
}

function providersWithDefaults(providers: AiProviderConfig[]): AiProviderConfig[] {
  const existing = new Map(providers.map((provider) => [provider.provider, provider]));
  return createDefaultAiProviders().map((provider) => existing.get(provider.provider) ?? provider);
}

function normalizeLegacySummary(value: unknown): AppSettings['aiLegacySummary'] {
  const summary = objectRecord(value);
  const builtInConflicts = Array.from(
    new Set(arrayOrEmpty<unknown>(summary.builtInConflicts).filter(isAiProviderType)),
  ).slice(0, AI_PROVIDER_TYPES.length);
  const customState =
    summary.customState === 'disabled_no_key' || summary.customState === 'conflict_has_key'
      ? summary.customState
      : 'absent';
  return { builtInConflicts, customState };
}

function normalizePublicSettingsRecord(
  settings: Record<string, unknown>,
  hasSecrets: ReadonlySet<AiProviderType> = new Set(),
): AppSettings {
  const normalizedProviders = providersWithDefaults(
    arrayOrEmpty<unknown>(settings.aiProviders)
      .map(normalizePublicProvider)
      .filter((provider): provider is AiProviderConfig => Boolean(provider)),
  ).map((provider) => ({
    ...provider,
    hasApiKey: hasSecrets.has(provider.provider),
  }));
  const activeProviderId =
    typeof settings.activeProviderId === 'string' &&
    normalizedProviders.some((provider) => provider.id === settings.activeProviderId)
      ? settings.activeProviderId
      : DEFAULT_SETTINGS.activeProviderId;
  const exportDirectory =
    typeof settings.exportDirectory === 'string' && settings.exportDirectory.trim()
      ? settings.exportDirectory
      : DEFAULT_SETTINGS.exportDirectory;

  return {
    useAi: settings.useAi === true,
    activeProviderId,
    aiProviders: normalizedProviders,
    aiLegacySummary: normalizeLegacySummary(settings.aiLegacySummary),
    customRules: normalizeCustomRules(settings.customRules),
    templates: normalizeTemplates(settings.templates),
    activeTemplateIds: normalizeActiveTemplateIds(settings.activeTemplateIds),
    defaultClassifyMode: normalizeClassifyMode(settings.defaultClassifyMode),
    exportDirectory,
  };
}

export function normalizeSettings(value: unknown): AppSettings {
  return normalizePublicSettingsRecord(safeSettingsRecord(value));
}

function isStoredPublicSettings(value: unknown): value is StoredPublicSettings {
  const record = objectRecord(value);
  return record.version === AI_PUBLIC_SETTINGS_VERSION && 'settings' in record;
}

function legacyProviderRecords(settings: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(settings.aiProviders)) {
    return [];
  }
  return settings.aiProviders.map(objectRecord);
}

function inspectLegacyAiSettings(rawValue: unknown): LegacyAiInspection {
  const settings = safeSettingsRecord(rawValue);
  const records = legacyProviderRecords(settings);
  const byProvider = new Map<AiProviderType, Record<string, unknown>[]>();
  const conflicts = new Set<AiProviderType>();
  const providers: AiProviderConfig[] = [];
  const secrets: AiProviderSecret[] = [];
  let customState: AppSettings['aiLegacySummary']['customState'] = 'absent';

  for (const record of records) {
    if (isAiProviderType(record.provider)) {
      const grouped = byProvider.get(record.provider) ?? [];
      grouped.push(record);
      byProvider.set(record.provider, grouped);
      continue;
    }
    if (record.provider === 'openai-compatible') {
      const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
      customState = apiKey.length > 0 ? 'conflict_has_key' : 'disabled_no_key';
    }
  }

  const deepSeekApiKey = typeof settings.deepSeekApiKey === 'string' ? settings.deepSeekApiKey : '';
  if (deepSeekApiKey) {
    const grouped = byProvider.get('deepseek') ?? [];
    grouped.push({
      provider: 'deepseek',
      enabled: true,
      apiKey: deepSeekApiKey,
      model: settings.deepSeekModel,
    });
    byProvider.set('deepseek', grouped);
  }

  for (const type of AI_PROVIDER_TYPES) {
    const template = providerTemplate(type);
    const recordsForProvider = byProvider.get(type) ?? [];
    if (recordsForProvider.length > 1) {
      conflicts.add(type);
      continue;
    }
    const record = recordsForProvider[0];
    const apiKey = typeof record?.apiKey === 'string' ? record.apiKey : '';
    const secret = apiKey ? createAiProviderSecret(type, apiKey) : undefined;
    if (apiKey && !secret) {
      conflicts.add(type);
      continue;
    }
    if (secret) {
      secrets.push(secret);
    }
    providers.push(
      createProviderFromTemplate(template, {
        enabled: record?.enabled !== false,
        model: isValidAiModel(record?.model) ? record.model : template.defaultModel,
        hasApiKey: Boolean(secret),
      }),
    );
  }

  const activeRecord = records.find((record) => record.id === settings.activeProviderId);
  const activeProvider = isAiProviderType(activeRecord?.provider)
    ? activeRecord.provider
    : ('deepseek' as const);
  const summary = {
    builtInConflicts: [...conflicts],
    customState,
  };
  return {
    settings,
    providers: providersWithDefaults(providers),
    secrets,
    activeProvider,
    useAi: settings.useAi === true || deepSeekApiKey.length > 0,
    summary,
    conflict: conflicts.size > 0 || customState === 'conflict_has_key',
  };
}

async function readAiProviderSecretsStrict(): Promise<AiProviderSecretsEnvelope> {
  const stored = await getLocalValue<unknown>(AI_PROVIDER_SECRETS_KEY, undefined);
  if (stored === undefined) {
    return emptyAiProviderSecrets();
  }
  const parsed = parseAiProviderSecrets(stored);
  if (!parsed) {
    throw new Error('secret_unavailable');
  }
  return parsed;
}

async function readAiProviderSecretsForPublicState(): Promise<AiProviderSecretsEnvelope> {
  try {
    return await readAiProviderSecretsStrict();
  } catch {
    return emptyAiProviderSecrets();
  }
}

async function writeAndVerifyAiProviderSecrets(
  envelope: AiProviderSecretsEnvelope,
): Promise<AiProviderSecretsEnvelope> {
  const parsed = parseAiProviderSecrets(envelope);
  if (!parsed) {
    throw new Error('secret_unavailable');
  }
  await setLocalValues({ [AI_PROVIDER_SECRETS_KEY]: parsed });
  const verified = parseAiProviderSecrets(
    await getLocalValue<unknown>(AI_PROVIDER_SECRETS_KEY, undefined),
  );
  if (!verified || JSON.stringify(verified) !== JSON.stringify(parsed)) {
    throw new Error('secret_unavailable');
  }
  return verified;
}

function settingsWithSecretPresence(
  settings: AppSettings,
  envelope: AiProviderSecretsEnvelope,
): AppSettings {
  const hasSecrets = new Set(envelope.providers.map((secret) => secret.provider));
  return {
    ...settings,
    aiProviders: settings.aiProviders.map((provider) => ({
      ...provider,
      hasApiKey: hasSecrets.has(provider.provider),
    })),
  };
}

async function persistPublicSettings(settings: AppSettings): Promise<void> {
  const stored: StoredPublicSettings = {
    version: AI_PUBLIC_SETTINGS_VERSION,
    settings,
  };
  await setLocalValues({ [SETTINGS_KEY]: stored });
}

async function migrateLegacySettings(rawValue: unknown): Promise<AppSettings> {
  const legacy = inspectLegacyAiSettings(rawValue);
  const currentSecrets =
    legacy.secrets.length > 0
      ? await readAiProviderSecretsStrict()
      : await readAiProviderSecretsForPublicState();

  if (legacy.conflict) {
    return settingsWithSecretPresence(
      {
        ...normalizePublicSettingsRecord(legacy.settings),
        useAi: false,
        activeProviderId: DEFAULT_ACTIVE_PROVIDER_ID,
        aiProviders: createDefaultAiProviders(),
        aiLegacySummary: legacy.summary,
      },
      currentSecrets,
    );
  }

  let nextSecrets = currentSecrets;
  for (const secret of legacy.secrets) {
    const next = upsertAiProviderSecret(nextSecrets, secret);
    if (!next) {
      throw new Error('secret_unavailable');
    }
    nextSecrets = next;
  }
  if (legacy.secrets.length > 0) {
    nextSecrets = await writeAndVerifyAiProviderSecrets(nextSecrets);
  }

  const settings = settingsWithSecretPresence(
    {
      ...normalizePublicSettingsRecord(legacy.settings),
      useAi: legacy.useAi,
      activeProviderId: createProviderFromTemplate(providerTemplate(legacy.activeProvider)).id,
      aiProviders: legacy.providers,
      aiLegacySummary: legacy.summary,
    },
    nextSecrets,
  );
  await persistPublicSettings(settings);
  return settings;
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await getLocalValue<unknown>(SETTINGS_KEY, {});
  const cloned = safeSettingsRecord(raw);
  if (!isStoredPublicSettings(cloned)) {
    return migrateLegacySettings(raw);
  }
  const envelope = await readAiProviderSecretsForPublicState();
  return settingsWithSecretPresence(
    normalizePublicSettingsRecord(safeSettingsRecord(cloned.settings)),
    envelope,
  );
}

export async function getBookmarkTaskSettings(): Promise<BookmarkTaskSettings> {
  const raw = await getLocalValue<unknown>(SETTINGS_KEY, {});
  const source = bookmarkTaskSettingsSource(raw);
  const secrets = await readAiProviderSecretsForPublicState();
  const secretProviders = new Set(secrets.providers.map((secret) => secret.provider));
  const providers = providersWithDefaults(
    arrayOrEmpty<unknown>(readBookmarkTaskField(source, 'aiProviders'))
      .map(normalizePublicProvider)
      .filter((provider): provider is AiProviderConfig => Boolean(provider)),
  ).map((provider) => ({
    ...provider,
    hasApiKey: secretProviders.has(provider.provider),
  }));
  const activeProviderIdValue = readBookmarkTaskField(source, 'activeProviderId');
  const activeProviderId =
    typeof activeProviderIdValue === 'string' &&
    providers.some((provider) => provider.id === activeProviderIdValue)
      ? activeProviderIdValue
      : DEFAULT_SETTINGS.activeProviderId;

  return {
    useAi: readBookmarkTaskField(source, 'useAi') === true,
    activeProviderId,
    aiProviders: providers,
    aiLegacySummary: normalizeLegacySummary(readBookmarkTaskField(source, 'aiLegacySummary')),
    customRules: normalizeCustomRules(readBookmarkTaskField(source, 'customRules')),
    defaultClassifyMode: normalizeClassifyMode(
      readBookmarkTaskField(source, 'defaultClassifyMode'),
    ),
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const raw = await getLocalValue<unknown>(SETTINGS_KEY, {});
  const cloned = safeSettingsRecord(raw);
  if (!isStoredPublicSettings(cloned) && inspectLegacyAiSettings(raw).conflict) {
    throw new Error('legacy_ai_config_conflict');
  }
  const secrets = await readAiProviderSecretsForPublicState();
  const normalized = settingsWithSecretPresence(
    normalizePublicSettingsRecord(safeSettingsRecord(settings)),
    secrets,
  );
  await persistPublicSettings(normalized);
}

export async function getAiProviderSecretForUse(
  provider: AiProviderType,
): Promise<AiProviderSecret | undefined> {
  return getAiProviderSecret(await readAiProviderSecretsStrict(), provider);
}

export async function setAiProviderSecret(provider: AiProviderType, apiKey: string): Promise<void> {
  const secret = createAiProviderSecret(provider, apiKey);
  if (!secret) {
    throw new Error('request_invalid');
  }
  const current = await readAiProviderSecretsStrict();
  const next = upsertAiProviderSecret(current, secret);
  if (!next) {
    throw new Error('secret_unavailable');
  }
  await writeAndVerifyAiProviderSecrets(next);
}

export async function clearAiProviderSecret(provider: AiProviderType): Promise<void> {
  await writeAndVerifyAiProviderSecrets(
    removeAiProviderSecret(await readAiProviderSecretsStrict(), provider),
  );
}

export async function discardLegacyAiConfiguration(): Promise<AppSettings> {
  const raw = await getLocalValue<unknown>(SETTINGS_KEY, {});
  const cloned = safeSettingsRecord(raw);
  if (isStoredPublicSettings(cloned)) {
    return getSettings();
  }
  const legacy = inspectLegacyAiSettings(raw);
  const settings = settingsWithSecretPresence(
    {
      ...normalizePublicSettingsRecord(legacy.settings),
      useAi: false,
      activeProviderId: DEFAULT_ACTIVE_PROVIDER_ID,
      aiProviders: createDefaultAiProviders(),
      aiLegacySummary: {
        builtInConflicts: [],
        customState: 'absent',
      },
    },
    await readAiProviderSecretsForPublicState(),
  );
  await persistPublicSettings(settings);
  return settings;
}

function validLegacyCapture(value: unknown): boolean {
  const capture = objectRecord(value);
  if (
    typeof capture.id !== 'string' ||
    capture.id.length === 0 ||
    capture.id.length > 512 ||
    !['page', 'twitter', 'weibo', 'article'].includes(String(capture.source)) ||
    typeof capture.title !== 'string' ||
    typeof capture.url !== 'string' ||
    typeof capture.text !== 'string' ||
    typeof capture.capturedAt !== 'string' ||
    !Array.isArray(capture.media) ||
    capture.media.length > 12 ||
    !Array.isArray(capture.tags) ||
    capture.tags.length > 64
  ) {
    return false;
  }
  return capture.media.every((item) => {
    const media = objectRecord(item);
    return (
      typeof media.url === 'string' &&
      media.url.length <= 8_192 &&
      (media.type === undefined || media.type === 'image' || media.type === 'video') &&
      (media.alt === undefined || (typeof media.alt === 'string' && media.alt.length <= 4_096))
    );
  });
}

export async function inspectLegacyPendingCapture(): Promise<LegacyPendingSummary> {
  try {
    const approximateBytes = await getLocalBytesInUse(PENDING_CAPTURE_KEY);
    if (approximateBytes === 0) {
      return {
        present: false,
        count: 0,
        approximateBytes,
        state: 'absent',
      };
    }
    if (approximateBytes > LEGACY_PENDING_MAX_BYTES) {
      return {
        present: true,
        count: null,
        approximateBytes,
        state: 'oversize',
      };
    }
    const raw = await getLocalValue<unknown>(PENDING_CAPTURE_KEY, undefined);
    let cloned: unknown;
    try {
      cloned = cloneBoundedStructuredValue(raw, {
        maxBytes: LEGACY_PENDING_MAX_BYTES,
        maxDepth: 8,
        maxNodes: 2_048,
        maxStringBytes: LEGACY_PENDING_MAX_BYTES,
      });
    } catch {
      return {
        present: true,
        count: null,
        approximateBytes,
        state: 'invalid',
      };
    }
    const captures = Array.isArray(cloned) ? cloned : [cloned];
    if (
      captures.length === 0 ||
      captures.length > 20 ||
      !captures.every((capture) => validLegacyCapture(capture))
    ) {
      return {
        present: true,
        count: null,
        approximateBytes,
        state: 'invalid',
      };
    }
    return {
      present: true,
      count: captures.length,
      approximateBytes,
      state: 'valid',
    };
  } catch {
    return {
      present: false,
      count: null,
      approximateBytes: 0,
      state: 'unavailable',
    };
  }
}

export async function clearLegacyPendingCapture(): Promise<void> {
  await removeLocalValues([PENDING_CAPTURE_KEY]);
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
