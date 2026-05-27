import { app, BrowserWindow, dialog } from 'electron';
import { registerIpcHandlers, sendBookmarksChanged, sendSyncStatus } from './ipc.js';
import { createMainWindow } from './window.js';
import { createAppTray } from './tray.js';
import { loadConfig, type AppConfig } from './app-config.js';
import { closeDatabase, initializeDatabase, resetDatabaseFiles } from './db/index.js';
import { ChromeBookmarkWatcher, type SyncStatus, type SyncStatusState } from './sync/index.js';
import { handleStartupError } from './startup-error.js';

let mainWindow: BrowserWindow | null = null;
let bookmarkWatcher: ChromeBookmarkWatcher | null = null;
let isQuitting = false;

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function restartBookmarkWatcher(config: AppConfig): Promise<void> {
  bookmarkWatcher?.stop();
  sendSyncStatus(mainWindow, createSyncStatus(
    'syncing',
    config.chromeProfile,
    '正在同步 Chrome 书签...',
  ));

  bookmarkWatcher = new ChromeBookmarkWatcher({
    profile: config.chromeProfile,
    onSync: (result) => {
      sendBookmarksChanged(mainWindow, result);
    },
    onError: (error) => {
      console.error('[ShuHai] Bookmark sync failed:', error);
      sendSyncStatus(mainWindow, createSyncStatus(
        'error',
        config.chromeProfile,
        '书签同步失败，请检查 Chrome Profile 后重试。',
        error.message,
      ));
    },
  });

  await bookmarkWatcher.syncNow();
  const startResult = bookmarkWatcher.start();
  if (startResult.success) {
    sendSyncStatus(mainWindow, createSyncStatus(
      'watching',
      config.chromeProfile,
      '书签同步正常，正在监听 Chrome 变化。',
    ));
  } else {
    sendSyncStatus(mainWindow, createSyncStatus(
      'not-started',
      config.chromeProfile,
      '未启动实时同步，请确认 Chrome 已安装并选择正确的 Profile。',
      startResult.reason,
    ));
  }
}

async function bootstrap(): Promise<void> {
  initializeDatabase();
  const config = await loadConfig();

  registerIpcHandlers({
    onConfigChanged: restartBookmarkWatcher,
  });

  mainWindow = await createMainWindow({
    initialBounds: config.windowBounds,
    isQuitting: () => isQuitting,
  });

  createAppTray({
    showMainWindow,
    syncNow: async () => {
      await bookmarkWatcher?.syncNow();
    },
    quit: () => {
      isQuitting = true;
      mainWindow?.destroy();
      app.quit();
    },
  });

  await restartBookmarkWatcher(config);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      void handleStartupError(error, {
        logError: (reason) => console.error('[ShuHai] Failed to start:', reason),
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
        showMessageBox: (options) => dialog.showMessageBox(options),
        resetDatabase: resetDatabaseFiles,
        relaunch: () => app.relaunch(),
        quit: () => app.exit(0),
      });
    });
}

app.on('activate', showMainWindow);

app.on('before-quit', () => {
  isQuitting = true;
  bookmarkWatcher?.stop();
  bookmarkWatcher = null;
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // Keep the app alive so the tray menu can reopen the main window.
});

function createSyncStatus(
  state: SyncStatusState,
  profile: string,
  message: string,
  reason?: string,
): SyncStatus {
  return {
    state,
    profile,
    message,
    reason,
    updatedAt: new Date().toISOString(),
  };
}
