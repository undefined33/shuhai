import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AIConfig, RawBookmark, ProcessedBookmark, ExportResult } from '@shuhai/shared';

export interface AppConfig {
  vaultPath: string;
  chromeProfile: string;
  ai: AIConfig;
  firstRunComplete: boolean;
  syncIntervalMinutes: number;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface BookmarkClassification {
  category: string;
  tags: string[];
  confidence?: number;
  aiClassified: boolean;
}

export type BookmarkClassificationRecord = Record<string, BookmarkClassification>;

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface UrlCheckProgress {
  total: number;
  completed: number;
  alive: number;
  dead: number;
  redirect: number;
  errors: number;
  currentUrl?: string;
}

export interface UrlCheckRecord {
  bookmarkId: string;
  checkedAt: string;
  statusCode?: number;
  finalUrl?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface DeadLinkReviewItem {
  bookmark: ProcessedBookmark;
  lastCheck: UrlCheckRecord | null;
}

export type SyncStatusState = 'syncing' | 'watching' | 'not-started' | 'error';

export interface SyncStatus {
  state: SyncStatusState;
  profile: string;
  message: string;
  reason?: string;
  updatedAt: string;
}

export interface SyncNextRun {
  nextRunAt: string | null;
  intervalMinutes: number;
  updatedAt: string;
}

export interface AiUsageDailySummary {
  date: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface AiUsageSummary {
  month: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
  daily: AiUsageDailySummary[];
  monthlyBudget?: number;
}

export interface ShuHaiAPI {
  getBookmarks(): Promise<ProcessedBookmark[]>;
  classifyBookmarks(urls: string[]): Promise<BookmarkClassificationRecord>;
  exportBookmarks(bookmarks: ProcessedBookmark[]): Promise<ExportResult>;
  getDeadLinkReviewItems(): Promise<DeadLinkReviewItem[]>;
  markBookmarksReviewed(ids: string[]): Promise<void>;
  removeBookmarks(ids: string[]): Promise<void>;
  updateBookmarkUrl(id: string, nextUrl: string): Promise<ProcessedBookmark | null>;
  getAiUsage(): Promise<AiUsageSummary>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: Partial<AppConfig>): Promise<AppConfig>;
  selectDirectory(): Promise<string | null>;
  getChromeProfiles(): Promise<string[]>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(itemPath: string): Promise<void>;
  openLogsDirectory(): Promise<string>;
  getSyncStatus(): Promise<SyncStatus | null>;
  getSyncNextRun(): Promise<SyncNextRun | null>;
  onSyncStatus(callback: (status: SyncStatus) => void): () => void;
  onSyncNextRun(callback: (state: SyncNextRun) => void): () => void;
  onBookmarksChanged(callback: (result: SyncResult) => void): () => void;
  startUrlCheck(): Promise<UrlCheckProgress>;
  abortUrlCheck(): Promise<boolean>;
  onUrlCheckProgress(callback: (progress: UrlCheckProgress) => void): () => void;
}

const api: ShuHaiAPI = {
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get') as Promise<ProcessedBookmark[]>,
  classifyBookmarks: (urls: string[]) => {
    return ipcRenderer.invoke('bookmarks:classify', urls) as Promise<BookmarkClassificationRecord>;
  },
  exportBookmarks: (bookmarks: ProcessedBookmark[]) => {
    return ipcRenderer.invoke('bookmarks:export', bookmarks) as Promise<ExportResult>;
  },
  getDeadLinkReviewItems: () => {
    return ipcRenderer.invoke('bookmarks:dead-link-review:get') as Promise<DeadLinkReviewItem[]>;
  },
  markBookmarksReviewed: (ids: string[]) => {
    return ipcRenderer.invoke('bookmarks:mark-reviewed', ids) as Promise<void>;
  },
  removeBookmarks: (ids: string[]) => {
    return ipcRenderer.invoke('bookmarks:remove', ids) as Promise<void>;
  },
  updateBookmarkUrl: (id: string, nextUrl: string) => {
    return ipcRenderer.invoke('bookmarks:update-url', id, nextUrl) as Promise<ProcessedBookmark | null>;
  },
  getAiUsage: () => ipcRenderer.invoke('ai:get-usage') as Promise<AiUsageSummary>,
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  setConfig: (config: Partial<AppConfig>) => {
    return ipcRenderer.invoke('config:set', config) as Promise<AppConfig>;
  },
  selectDirectory: () => ipcRenderer.invoke('system:select-directory') as Promise<string | null>,
  getChromeProfiles: () => ipcRenderer.invoke('system:get-chrome-profiles') as Promise<string[]>,
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<void>,
  showItemInFolder: (itemPath: string) => {
    return ipcRenderer.invoke('system:show-item-in-folder', itemPath) as Promise<void>;
  },
  openLogsDirectory: () => ipcRenderer.invoke('system:open-logs-directory') as Promise<string>,
  getSyncStatus: () => ipcRenderer.invoke('sync:status:get') as Promise<SyncStatus | null>,
  getSyncNextRun: () => ipcRenderer.invoke('sync:next-run:get') as Promise<SyncNextRun | null>,
  startUrlCheck: () => ipcRenderer.invoke('url-check:start') as Promise<UrlCheckProgress>,
  abortUrlCheck: () => ipcRenderer.invoke('url-check:abort') as Promise<boolean>,
  onBookmarksChanged: (callback: (result: SyncResult) => void) => {
    const listener = (_event: IpcRendererEvent, result: SyncResult) => {
      callback(result);
    };
    ipcRenderer.on('bookmarks:changed', listener);
    return () => {
      ipcRenderer.removeListener('bookmarks:changed', listener);
    };
  },
  onSyncStatus: (callback: (status: SyncStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatus) => {
      callback(status);
    };
    ipcRenderer.on('sync:status', listener);
    return () => {
      ipcRenderer.removeListener('sync:status', listener);
    };
  },
  onSyncNextRun: (callback: (state: SyncNextRun) => void) => {
    const listener = (_event: IpcRendererEvent, state: SyncNextRun) => {
      callback(state);
    };
    ipcRenderer.on('sync:next-run', listener);
    return () => {
      ipcRenderer.removeListener('sync:next-run', listener);
    };
  },
  onUrlCheckProgress: (callback: (progress: UrlCheckProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: UrlCheckProgress) => {
      callback(progress);
    };
    ipcRenderer.on('url-check:progress', listener);
    return () => {
      ipcRenderer.removeListener('url-check:progress', listener);
    };
  },
};

contextBridge.exposeInMainWorld('shuhai', api);

declare global {
  interface Window {
    shuhai: ShuHaiAPI;
  }
}

export type { RawBookmark, ProcessedBookmark };
