export const EXACT_X_BOOKMARKS_URL = 'https://x.com/i/bookmarks';

const X_STATUS_PATH = /^\/[A-Za-z0-9_]{1,15}\/status\/\d{1,19}$/u;
const MAX_TAB_URL_LENGTH = 8_192;

export type PopupTabKind = 'x-bookmarks' | 'x-status' | 'ordinary';

export interface PopupBrowserContext {
  readonly windowId: number;
  readonly tabKind: PopupTabKind;
}

function safeTabUrl(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > MAX_TAB_URL_LENGTH ||
    value.includes('\\')
  ) {
    return undefined;
  }
  return value;
}

export function classifyPopupTabUrl(value: unknown): PopupTabKind {
  const safeValue = safeTabUrl(value);
  if (!safeValue) {
    return 'ordinary';
  }
  if (safeValue === EXACT_X_BOOKMARKS_URL) {
    return 'x-bookmarks';
  }

  try {
    const parsed = new URL(safeValue);
    if (
      parsed.origin === 'https://x.com' &&
      parsed.protocol === 'https:' &&
      parsed.hostname === 'x.com' &&
      parsed.username === '' &&
      parsed.password === '' &&
      (parsed.port === '' || parsed.port === '443') &&
      X_STATUS_PATH.test(parsed.pathname)
    ) {
      return 'x-status';
    }
  } catch {
    return 'ordinary';
  }
  return 'ordinary';
}

function getCurrentWindowId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent((currentWindow) => {
      if (chrome.runtime.lastError || typeof currentWindow.id !== 'number') {
        reject(new Error('window_unavailable'));
        return;
      }
      resolve(currentWindow.id);
    });
  });
}

function getActiveTabUrl(windowId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      const tab = tabs[0];
      if (
        chrome.runtime.lastError ||
        tabs.length !== 1 ||
        !tab ||
        tab.windowId !== windowId ||
        typeof tab.url !== 'string'
      ) {
        reject(new Error('active_tab_unavailable'));
        return;
      }
      resolve(tab.url);
    });
  });
}

export async function getPopupBrowserContext(): Promise<PopupBrowserContext> {
  const windowId = await getCurrentWindowId();
  return {
    windowId,
    tabKind: classifyPopupTabUrl(await getActiveTabUrl(windowId)),
  };
}
