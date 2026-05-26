import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers, sendBookmarksChanged } from './ipc.js';
import { createMainWindow } from './window.js';
import { createAppTray } from './tray.js';
import { loadConfig, type AppConfig } from './app-config.js';
import { closeDatabase, initializeDatabase } from './db/index.js';
import { ChromeBookmarkWatcher } from './sync/index.js';

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

  bookmarkWatcher = new ChromeBookmarkWatcher({
    profile: config.chromeProfile,
    onSync: (result) => {
      sendBookmarksChanged(mainWindow, result);
    },
    onError: (error) => {
      console.error('[ShuHai] Bookmark sync failed:', error);
    },
  });

  await bookmarkWatcher.syncNow();
  bookmarkWatcher.start();
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
      console.error('[ShuHai] Failed to start:', error);
      app.quit();
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
