import type {
  AiProviderConfig,
  AiProviderType,
  AppSettings,
  CapturedContent,
  ClassificationMode,
  CustomRule,
  ExportManifest,
  MoveRecord,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import { PROVIDER_TEMPLATES } from '../shared/bookmark-types.js';
import type { OnboardingProgress } from './onboarding.js';
import {
  DEFAULT_ACTIVE_PROVIDER_ID,
  createDefaultAiProviders,
  createProviderFromTemplate,
  providerTemplate,
  trimTrailingSlash,
} from '../shared/ai-providers.js';

export const SETTINGS_KEY = 'settings';
export const LAST_MOVE_RECORDS_KEY = 'lastMoveRecords';
export const EXPORT_MANIFESTS_KEY = 'exportManifests';
export const PENDING_CAPTURE_KEY = 'pendingCapture';
export const URL_HEALTH_RECORDS_KEY = 'urlHealthRecords';
export const ONBOARDED_KEY = 'onboarded';
export const ONBOARDING_PROGRESS_KEY = 'onboardingProgress';

export const DEFAULT_SETTINGS: AppSettings = {
  useAi: false,
  activeProviderId: DEFAULT_ACTIVE_PROVIDER_ID,
  aiProviders: createDefaultAiProviders(),
  customRules: [],
  defaultClassifyMode: 'safe',
  exportDirectory: 'Bookmarks',
};

function getLastError(): Error | undefined {
  const message = chrome.runtime.lastError?.message;
  return message ? new Error(message) : undefined;
}

export function getLocalValue<T>(key: string, fallback: T): Promise<T> {
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

export function setLocalValues(values: Record<string, unknown>): Promise<void> {
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

export function removeLocalValues(keys: string[]): Promise<void> {
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
  return arrayOrEmpty<CustomRule>(value).filter(
    (rule) =>
      (rule.type === 'domain' || rule.type === 'title-keyword') &&
      typeof rule.pattern === 'string' &&
      typeof rule.category === 'string' &&
      Array.isArray(rule.tags),
  );
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

export function getUrlHealthRecords(): Promise<UrlHealthRecord[]> {
  return getLocalValue<UrlHealthRecord[]>(URL_HEALTH_RECORDS_KEY, []);
}

export function saveUrlHealthRecords(records: UrlHealthRecord[]): Promise<void> {
  return setLocalValues({ [URL_HEALTH_RECORDS_KEY]: records });
}

export function clearUrlHealthRecords(): Promise<void> {
  return removeLocalValues([URL_HEALTH_RECORDS_KEY]);
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
