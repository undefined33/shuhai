import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc.js';
import { createMainWindow } from './window.js';
import { createAppTray } from './tray.js';
import { syncAllBookmarks } from './bookmark-service.js';
import { loadConfig } from './app-config.js';
import { closeDatabase, initializeDatabase } from './db/index.js';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function bootstrap(): Promise<void> {
  initializeDatabase();
  const config = await loadConfig();

  registerIpcHandlers();

  mainWindow = await createMainWindow({
    initialBounds: config.windowBounds,
    isQuitting: () => isQuitting,
  });

  createAppTray({
    showMainWindow,
    syncNow: async () => {
      const currentConfig = await loadConfig();
      await syncAllBookmarks(currentConfig);
    },
    quit: () => {
      isQuitting = true;
      mainWindow?.destroy();
      app.quit();
    },
  });
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
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // Keep the app alive so the tray menu can reopen the main window.
});
