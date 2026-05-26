import { contextBridge, ipcRenderer } from 'electron';
import type { RawBookmark, ProcessedBookmark, ExportResult } from '@shuhai/shared';
import type { AppConfig } from './main/app-config.js';
import type { BookmarkClassification } from './main/bookmark-service.js';

export interface ShuHaiAPI {
  getBookmarks(): Promise<ProcessedBookmark[]>;
  classifyBookmarks(urls: string[]): Promise<Map<string, BookmarkClassification>>;
  exportBookmarks(bookmarks: ProcessedBookmark[]): Promise<ExportResult>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: Partial<AppConfig>): Promise<AppConfig>;
  selectDirectory(): Promise<string | null>;
  getChromeProfiles(): Promise<string[]>;
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
};

contextBridge.exposeInMainWorld('shuhai', api);

declare global {
  interface Window {
    shuhai: ShuHaiAPI;
  }
}

export type { RawBookmark, ProcessedBookmark };
