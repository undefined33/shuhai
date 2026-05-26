import { watch, type FSWatcher } from 'node:fs';
import {
  syncChromeBookmarks,
  type ChromeBookmarkReader,
  type SyncResult,
} from '../bookmark-service.js';
import { ChromeFileReader } from '../readers/chrome-file-reader.js';
import type { ShuHaiDatabase } from '../db/index.js';

export type { SyncResult } from '../bookmark-service.js';

export interface ChromeWatcherOptions {
  profile: string;
  debounceMs?: number;
  onSync?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
  database?: ShuHaiDatabase;
  readerFactory?: (profile: string) => ChromeBookmarkReader;
}

const DEFAULT_DEBOUNCE_MS = 2_000;
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

  start(): void {
    if (this.watcher) {
      return;
    }

    const reader = this.createReader();
    if (!reader.exists()) {
      return;
    }

    try {
      this.watcher = watch(reader.getPath(), () => {
        this.scheduleSync();
      });
    } catch (error) {
      this.reportError(error);
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
    console.error('[ShuHai] Chrome bookmark watcher error:', normalized);
    this.options.onError?.(normalized);
  }
}

function hasChanges(result: SyncResult): boolean {
  return result.added > 0 || result.updated > 0 || result.removed > 0;
}
