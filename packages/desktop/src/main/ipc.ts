import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { ProcessedBookmark } from '@shuhai/shared';
import {
  loadConfig,
  loadPublicConfig,
  updatePublicConfig,
  type AppConfig,
} from './app-config.js';
import {
  abortUrlHealthCheck,
  classifyBookmarks,
  detectChromeProfiles,
  exportProcessedBookmarks,
  getBookmarkSnapshot,
  getAiUsageSummary,
  getDeadLinkReviewItems,
  markBookmarksReviewed,
  removeBookmarksFromShuHai,
  runUrlHealthCheck,
  updateBookmarkUrl,
} from './bookmark-service.js';
import type { SyncResult, SyncStatus } from './sync/index.js';
import type { SyncNextRun } from './sync/index.js';
import { assertAllowedExternalUrl } from './external-url.js';
import { classificationMapToRecord } from './classification-serialization.js';
import { createLogger, initializeLogging } from './logger.js';

let latestSyncStatus: SyncStatus | null = null;
let latestSyncNextRun: SyncNextRun | null = null;
const logger = createLogger('ipc');

interface IpcHandlerOptions {
  onConfigChanged?: (config: AppConfig) => Promise<void> | void;
}

export function registerIpcHandlers(options: IpcHandlerOptions = {}): void {
  ipcMain.handle('config:get', () => loadPublicConfig());

  ipcMain.handle('config:set', async (_event, partial: Partial<AppConfig>) => {
    const config = await updatePublicConfig(partial);
    logger.info('Configuration changed', {
      chromeProfile: config.chromeProfile,
      syncIntervalMinutes: config.syncIntervalMinutes,
      aiProvider: config.ai.provider,
      hasAiKey: Boolean(config.ai.apiKey),
    });
    await options.onConfigChanged?.(config);
    return config;
  });

  ipcMain.handle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择 Obsidian Vault 目录',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('system:get-chrome-profiles', () => detectChromeProfiles());

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    assertAllowedExternalUrl(url);
    await shell.openExternal(url);
  });

  ipcMain.handle('system:show-item-in-folder', (_event, itemPath: string) => {
    shell.showItemInFolder(itemPath);
  });

  ipcMain.handle('system:open-logs-directory', async () => {
    const logsDir = initializeLogging();
    await shell.openPath(logsDir);
    return logsDir;
  });

  ipcMain.handle('sync:status:get', () => latestSyncStatus);
  ipcMain.handle('sync:next-run:get', () => latestSyncNextRun);

  ipcMain.handle('bookmarks:get', async () => getBookmarkSnapshot(await loadConfig()));

  ipcMain.handle('bookmarks:classify', async (_event, urls: string[]) => {
    const result = await classifyBookmarks(urls, await loadConfig());
    return classificationMapToRecord(result);
  });

  ipcMain.handle('ai:get-usage', async () => {
    return getAiUsageSummary(await loadConfig());
  });

  ipcMain.handle('bookmarks:export', async (_event, bookmarks: ProcessedBookmark[]) => {
    return exportProcessedBookmarks(bookmarks, await loadConfig());
  });

  ipcMain.handle('bookmarks:dead-link-review:get', () => {
    return getDeadLinkReviewItems();
  });

  ipcMain.handle('bookmarks:mark-reviewed', (_event, ids: string[]) => {
    markBookmarksReviewed(ids);
  });

  ipcMain.handle('bookmarks:remove', (_event, ids: string[]) => {
    removeBookmarksFromShuHai(ids);
  });

  ipcMain.handle('bookmarks:update-url', (_event, id: string, nextUrl: string) => {
    return updateBookmarkUrl(id, nextUrl);
  });

  ipcMain.handle('url-check:start', async (event) => {
    return runUrlHealthCheck({
      onProgress: (progress) => {
        event.sender.send('url-check:progress', progress);
      },
    });
  });

  ipcMain.handle('url-check:abort', () => {
    abortUrlHealthCheck();
    return true;
  });
}

export function sendBookmarksChanged(
  window: BrowserWindow | null,
  result: SyncResult,
): void {
  window?.webContents.send('bookmarks:changed', result);
}

export function sendSyncStatus(
  window: BrowserWindow | null,
  status: SyncStatus,
): void {
  latestSyncStatus = status;
  window?.webContents.send('sync:status', status);
}

export function sendSyncNextRun(
  window: BrowserWindow | null,
  state: SyncNextRun,
): void {
  latestSyncNextRun = state;
  window?.webContents.send('sync:next-run', state);
}
