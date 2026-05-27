import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { ProcessedBookmark } from '@shuhai/shared';
import { loadConfig, updateConfig, type AppConfig } from './app-config.js';
import {
  abortUrlHealthCheck,
  classifyBookmarks,
  detectChromeProfiles,
  exportProcessedBookmarks,
  getBookmarkSnapshot,
  runUrlHealthCheck,
} from './bookmark-service.js';
import type { SyncResult } from './sync/index.js';
import { assertAllowedExternalUrl } from './external-url.js';
import { classificationMapToRecord } from './classification-serialization.js';

interface IpcHandlerOptions {
  onConfigChanged?: (config: AppConfig) => Promise<void> | void;
}

export function registerIpcHandlers(options: IpcHandlerOptions = {}): void {
  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:set', async (_event, partial: Partial<AppConfig>) => {
    const config = await updateConfig(partial);
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

  ipcMain.handle('bookmarks:get', async () => getBookmarkSnapshot(await loadConfig()));

  ipcMain.handle('bookmarks:classify', async (_event, urls: string[]) => {
    const result = await classifyBookmarks(urls, await loadConfig());
    return classificationMapToRecord(result);
  });

  ipcMain.handle('bookmarks:export', async (_event, bookmarks: ProcessedBookmark[]) => {
    return exportProcessedBookmarks(bookmarks, await loadConfig());
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
