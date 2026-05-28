import type {
  AppSettings,
  CapturedContent,
  ExportManifest,
  MoveRecord,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';

export const SETTINGS_KEY = 'settings';
export const LAST_MOVE_RECORDS_KEY = 'lastMoveRecords';
export const EXPORT_MANIFESTS_KEY = 'exportManifests';
export const PENDING_CAPTURE_KEY = 'pendingCapture';
export const URL_HEALTH_RECORDS_KEY = 'urlHealthRecords';
export const ONBOARDED_KEY = 'onboarded';

export const DEFAULT_SETTINGS: AppSettings = {
  deepSeekApiKey: '',
  deepSeekModel: 'deepseek-chat',
  useAi: false,
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

export async function getSettings(): Promise<AppSettings> {
  const settings = await getLocalValue<Partial<AppSettings>>(SETTINGS_KEY, {});

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    customRules: Array.isArray(settings.customRules) ? settings.customRules : [],
  };
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
