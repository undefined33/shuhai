import type { AppSettings, MoveRecord } from '../shared/bookmark-types.js';

export const SETTINGS_KEY = 'settings';
export const LAST_MOVE_RECORDS_KEY = 'lastMoveRecords';

export const DEFAULT_SETTINGS: AppSettings = {
  deepSeekApiKey: '',
  deepSeekModel: 'deepseek-chat',
  useAi: false,
  customRules: [],
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
