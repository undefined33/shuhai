import { dialog, ipcMain } from 'electron';
import type { ProcessedBookmark } from '@shuhai/shared';
import { loadConfig, updateConfig, type AppConfig } from './app-config.js';
import {
  classifyBookmarks,
  detectChromeProfiles,
  exportProcessedBookmarks,
  getBookmarkSnapshot,
} from './bookmark-service.js';

export function registerIpcHandlers(): void {
  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:set', (_event, partial: Partial<AppConfig>) => updateConfig(partial));

  ipcMain.handle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择 Obsidian Vault 目录',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('system:get-chrome-profiles', () => detectChromeProfiles());

  ipcMain.handle('bookmarks:get', async () => getBookmarkSnapshot(await loadConfig()));

  ipcMain.handle('bookmarks:classify', async (_event, urls: string[]) => {
    return classifyBookmarks(urls, await loadConfig());
  });

  ipcMain.handle('bookmarks:export', async (_event, bookmarks: ProcessedBookmark[]) => {
    return exportProcessedBookmarks(bookmarks, await loadConfig());
  });
}
