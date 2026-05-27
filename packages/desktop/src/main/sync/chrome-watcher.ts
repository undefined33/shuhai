import { watch, type FSWatcher } from 'node:fs';
import {
  syncChromeBookmarks,
  type ChromeBookmarkReader,
  type SyncResult,
} from '../bookmark-service.js';
import { ChromeFileReader } from '../readers/chrome-file-reader.js';
import type { ShuHaiDatabase } from '../db/index.js';
import { createLogger } from '../logger.js';

export type { SyncResult } from '../bookmark-service.js';

export interface ChromeWatcherOptions {
  profile: string;
  debounceMs?: number;
  onSync?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
  database?: ShuHaiDatabase;
  readerFactory?: (profile: string) => ChromeBookmarkReader;
}

export interface ChromeWatcherStartResult {
  success: boolean;
  reason?: string;
  path?: string;
}

export type SyncStatusState = 'syncing' | 'watching' | 'not-started' | 'error';

export interface SyncStatus {
  state: SyncStatusState;
  profile: string;
  message: string;
  reason?: string;
  updatedAt: string;
}

const DEFAULT_DEBOUNCE_MS = 2_000;
const logger = createLogger('chrome-watcher');
const EMPTY_SYNC_RESULT: SyncResult = {
  added: 0,
  updated: 0,
  removed: 0,
  total: 0,
};

export class ChromeBookmarkWatcher {
  private readonly debounceMs: number;
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private pendingSync = false;

  constructor(private readonly options: ChromeWatcherOptions) {
    this.debounceMs = Math.max(options.debounceMs ?? DEFAULT_DEBOUNCE_MS, DEFAULT_DEBOUNCE_MS);
  }

  start(): ChromeWatcherStartResult {
    if (this.watcher) {
      return { success: true };
    }

    const reader = this.createReader();
    if (!reader.exists()) {
      return {
        success: false,
        path: reader.getPath(),
        reason: '未检测到 Chrome 书签文件，请确认 Chrome 已安装并选择正确的 Profile。',
      };
    }

    try {
      this.watcher = watch(reader.getPath(), () => {
        this.scheduleSync();
      });
      return { success: true, path: reader.getPath() };
    } catch (error) {
      this.reportError(error);
      return {
        success: false,
        path: reader.getPath(),
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingSync = false;
    this.watcher?.close();
    this.watcher = null;
  }

  async syncNow(): Promise<SyncResult> {
    return this.runSync();
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSync();
    }, this.debounceMs);
  }

  private async runSync(): Promise<SyncResult> {
    if (this.isSyncing) {
      this.pendingSync = true;
      return EMPTY_SYNC_RESULT;
    }

    this.isSyncing = true;
    try {
      const result = await syncChromeBookmarks({
        profile: this.options.profile,
        database: this.options.database,
        reader: this.createReader(),
      });

      if (hasChanges(result)) {
        this.options.onSync?.(result);
      }

      return result;
    } catch (error) {
      this.reportError(error);
      return EMPTY_SYNC_RESULT;
    } finally {
      this.isSyncing = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        void this.runSync();
      }
    }
  }

  private createReader(): ChromeBookmarkReader {
    return this.options.readerFactory?.(this.options.profile) ?? new ChromeFileReader(this.options.profile);
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    logger.error('Chrome bookmark watcher error', { error: normalized });
    this.options.onError?.(normalized);
  }
}

function hasChanges(result: SyncResult): boolean {
  return result.added > 0 || result.updated > 0 || result.removed > 0;
}
