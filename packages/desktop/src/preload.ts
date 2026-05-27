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

export interface ShuHaiAPI {
  getBookmarks(): Promise<ProcessedBookmark[]>;
  classifyBookmarks(urls: string[]): Promise<Map<string, BookmarkClassification>>;
  exportBookmarks(bookmarks: ProcessedBookmark[]): Promise<ExportResult>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: Partial<AppConfig>): Promise<AppConfig>;
  selectDirectory(): Promise<string | null>;
  getChromeProfiles(): Promise<string[]>;
  openExternal(url: string): Promise<void>;
  onBookmarksChanged(callback: (result: SyncResult) => void): () => void;
  startUrlCheck(): Promise<UrlCheckProgress>;
  abortUrlCheck(): Promise<boolean>;
  onUrlCheckProgress(callback: (progress: UrlCheckProgress) => void): () => void;
}

const api: ShuHaiAPI = {
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get') as Promise<ProcessedBookmark[]>,
  classifyBookmarks: (urls: string[]) => {
    return ipcRenderer.invoke('bookmarks:classify', urls) as Promise<
      Map<string, BookmarkClassification>
    >;
  },
  exportBookmarks: (bookmarks: ProcessedBookmark[]) => {
    return ipcRenderer.invoke('bookmarks:export', bookmarks) as Promise<ExportResult>;
  },
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  setConfig: (config: Partial<AppConfig>) => {
    return ipcRenderer.invoke('config:set', config) as Promise<AppConfig>;
  },
  selectDirectory: () => ipcRenderer.invoke('system:select-directory') as Promise<string | null>,
  getChromeProfiles: () => ipcRenderer.invoke('system:get-chrome-profiles') as Promise<string[]>,
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<void>,
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
